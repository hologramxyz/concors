//! Agent notification sounds, played by the OS instead of the webview.
//!
//! Adapted from Herdr's `src/sound.rs` (Apache-2.0, revision
//! b99002ac99b09e00b4ca692436cb15a6b0d676f1): the embedded mp3 is written to a temp file and
//! handed to afplay (macOS), Windows MediaPlayer, or the first decoder-capable Linux player.
//! Web Audio in WebKitGTK needs a user gesture after every launch and GStreamer codecs, so
//! alerts for an agent that finishes in the background were often silent.
//!
//! Settings → Notifications picks one of the built-in sounds per event, or a file of the person's
//! own, and a volume; the webview sends the choice with each sound.
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

macro_rules! sounds {
    ($($name:literal),*) => {
        fn built_in(name: &str) -> Option<&'static [u8]> {
            match name {
                $($name => Some(include_bytes!(concat!("../../src/notifications/sounds/", $name, ".mp3"))),)*
                _ => None,
            }
        }
    };
}
sounds!("done", "request", "chime", "ping", "pop", "bell", "rise", "knock");
/// What a picked file may be; anything else is refused rather than handed to a player.
const EXTENSIONS: &[&str] = &["mp3", "wav", "m4a", "aac", "ogg", "flac", "aiff"];
const MAX_CUSTOM_BYTES: usize = 1024 * 1024;
static COUNTER: AtomicU64 = AtomicU64::new(0);
static PLAYING: AtomicUsize = AtomicUsize::new(0);
const TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub async fn play_agent_sound(sound: String, volume: Option<f64>) -> Result<(), String> {
    // Older webviews named the event rather than the sound.
    let name = match sound.as_str() {
        "needs_input" => "request",
        name => name,
    };
    let data = built_in(name).ok_or("Unknown sound")?;
    play(data.to_vec(), "mp3", volume.unwrap_or(1.0)).await
}

/// A file the person picked, sent as the raw request body with its extension and volume in headers.
#[tauri::command]
pub async fn play_custom_sound(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected the sound file's bytes".into());
    };
    if data.is_empty() || data.len() > MAX_CUSTOM_BYTES {
        return Err("Sound files must be under 1 MB".into());
    }
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    };
    let extension = header("x-sound-extension").to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err("Unsupported sound file".into());
    }
    let volume = header("x-sound-volume").parse().unwrap_or(1.0);
    play(data.clone(), &extension, volume).await
}

async fn play(data: Vec<u8>, extension: &str, volume: f64) -> Result<(), String> {
    let volume = if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    };
    if volume == 0.0 {
        return Ok(());
    }
    let extension = extension.to_owned();
    // A burst of agents finishing together plays a few sounds, not a pile of processes.
    if PLAYING.fetch_add(1, Ordering::SeqCst) >= 4 {
        PLAYING.fetch_sub(1, Ordering::SeqCst);
        return Ok(());
    }
    let result =
        tauri::async_runtime::spawn_blocking(move || play_bytes(&data, &extension, volume))
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
    PLAYING.fetch_sub(1, Ordering::SeqCst);
    if let Err(error) = &result {
        log::warn!("Agent sound failed: {error}");
    }
    result
}

fn play_bytes(data: &[u8], extension: &str, volume: f64) -> Result<(), String> {
    // Players pick a decoder by extension, so the file keeps the one it came with.
    let path = std::env::temp_dir().join(format!(
        "concors-sound-{}-{}.{extension}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = std::fs::File::create(&path).and_then(|mut file| file.write_all(data));
    let result = written
        .map_err(|error| error.to_string())
        .and_then(|()| play_file(&path, volume));
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(target_os = "macos")]
fn play_file(path: &Path, volume: f64) -> Result<(), String> {
    // afplay's -v is linear, 1 being the file's own level.
    run(Command::new("afplay")
        .arg("-v")
        .arg(volume.to_string())
        .arg(path))
}

#[cfg(windows)]
fn play_file(path: &Path, volume: f64) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    run(Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_PLAYER,
        ])
        .env("CONCORS_SOUND_PATH", path)
        .env("CONCORS_SOUND_VOLUME", volume.to_string())
        .creation_flags(CREATE_NO_WINDOW))
}

#[cfg(windows)]
const WINDOWS_PLAYER: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$resolved = (Resolve-Path -LiteralPath $env:CONCORS_SOUND_PATH).ProviderPath
$script:player = [System.Windows.Media.MediaPlayer]::new()
$script:player.Volume = [double]::Parse($env:CONCORS_SOUND_VOLUME, [Globalization.CultureInfo]::InvariantCulture)
$script:frame = [System.Windows.Threading.DispatcherFrame]::new()
$script:timer = [System.Windows.Threading.DispatcherTimer]::new()
$script:timer.Interval = [TimeSpan]::FromSeconds(15)
$script:failed = $null
$script:player.add_MediaOpened({ $script:player.Play() })
$script:player.add_MediaEnded({ $script:frame.Continue = $false })
$script:player.add_MediaFailed({
    param($sender, $eventArgs)
    $script:failed = $eventArgs.ErrorException
    $script:frame.Continue = $false
})
$script:timer.add_Tick({ $script:frame.Continue = $false })
try {
    $script:player.Open([Uri]::new($resolved))
    $script:timer.Start()
    [System.Windows.Threading.Dispatcher]::PushFrame($script:frame)
} finally {
    $script:timer.Stop()
    $script:player.Close()
}
if ($script:failed) { throw "sound media failed: $($script:failed.Message)" }
"#;

#[cfg(not(any(windows, target_os = "macos")))]
fn play_file(path: &Path, volume: f64) -> Result<(), String> {
    let mut errors = Vec::new();
    for (program, args) in linux_players(volume) {
        match run(Command::new(program).args(args).arg(path)) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(format!("{program}: {error}")),
        }
    }
    Err(format!(
        "No audio player could play the sound ({})",
        errors.join("; ")
    ))
}

/// The Linux players to try in turn, each with the volume in its own units. Never bare aplay: it
/// does not decode MP3 and plays the bytes as raw PCM noise.
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn linux_players(volume: f64) -> Vec<(&'static str, Vec<String>)> {
    let percent = (volume * 100.0).round().to_string();
    vec![
        (
            "paplay",
            vec![format!("--volume={}", (volume * 65536.0).round())],
        ),
        ("pw-play", vec![format!("--volume={volume}")]),
        (
            "ffplay",
            [
                "-nodisp",
                "-autoexit",
                "-loglevel",
                "quiet",
                "-volume",
                &percent,
            ]
            .map(String::from)
            .to_vec(),
        ),
        (
            "mpg123",
            vec![
                "-q".into(),
                "-f".into(),
                (volume * 32768.0).round().to_string(),
            ],
        ),
        (
            "mpv",
            vec![
                "--no-video".into(),
                "--really-quiet".into(),
                format!("--volume={percent}"),
            ],
        ),
    ]
}

fn run(command: &mut Command) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    // stderr carries the player's own reason (e.g. afplay's "AudioQueueStart failed"), which is
    // what someone needs to fix their audio; a bare exit code tells them nothing.
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start {program}: {error}"))?;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut pipe, &mut stderr);
                }
                return Err(failure(&program, &status.to_string(), &stderr));
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} timed out"));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

/// One readable line: the player's first line of stderr, or its exit status when it said nothing.
fn failure(program: &str, status: &str, stderr: &str) -> String {
    match stderr.lines().map(str::trim).find(|line| !line.is_empty()) {
        Some(line) => format!("{program}: {}", line.chars().take(200).collect::<String>()),
        None => format!("{program} {status}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{built_in, failure, linux_players};

    #[test]
    fn every_sound_the_settings_offer_is_built_in() {
        for name in [
            "done", "request", "chime", "ping", "pop", "bell", "rise", "knock",
        ] {
            assert!(
                built_in(name).is_some_and(|data| !data.is_empty()),
                "{name}"
            );
        }
        assert!(built_in("../secrets").is_none());
    }

    #[test]
    fn linux_players_get_the_volume_in_their_own_units() {
        let players = linux_players(0.5);
        let args = |name: &str| {
            players
                .iter()
                .find(|(p, _)| *p == name)
                .unwrap()
                .1
                .join(" ")
        };
        assert_eq!(args("paplay"), "--volume=32768");
        assert_eq!(args("pw-play"), "--volume=0.5");
        assert!(args("ffplay").ends_with("-volume 50"));
        assert_eq!(args("mpg123"), "-q -f 16384");
        assert!(args("mpv").ends_with("--volume=50"));
    }

    #[test]
    fn failure_prefers_the_players_own_reason() {
        assert_eq!(
            failure(
                "afplay",
                "exit status: 1",
                "\nError: AudioQueueStart failed ('!dev')\n"
            ),
            "afplay: Error: AudioQueueStart failed ('!dev')"
        );
        assert_eq!(
            failure("afplay", "exit status: 1", "  \n"),
            "afplay exit status: 1"
        );
    }
}
