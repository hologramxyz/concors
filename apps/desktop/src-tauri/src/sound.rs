//! Agent notification sounds, played by the OS instead of the webview.
//!
//! Adapted from Herdr's `src/sound.rs` (Apache-2.0, revision
//! b99002ac99b09e00b4ca692436cb15a6b0d676f1): the embedded mp3 is written to a temp file and
//! handed to afplay (macOS), Windows MediaPlayer, or the first decoder-capable Linux player.
//! Web Audio in WebKitGTK needs a user gesture after every launch and GStreamer codecs, so
//! alerts for an agent that finishes in the background were often silent.
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

static DONE: &[u8] = include_bytes!("../../src/notifications/sounds/done.mp3");
static REQUEST: &[u8] = include_bytes!("../../src/notifications/sounds/request.mp3");
static COUNTER: AtomicU64 = AtomicU64::new(0);
static PLAYING: AtomicUsize = AtomicUsize::new(0);
const TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub async fn play_agent_sound(kind: String) -> Result<(), String> {
    let data = match kind.as_str() {
        "done" => DONE,
        "needs_input" => REQUEST,
        _ => return Err("Unknown sound".into()),
    };
    // A burst of agents finishing together plays a few sounds, not a pile of processes.
    if PLAYING.fetch_add(1, Ordering::SeqCst) >= 4 {
        PLAYING.fetch_sub(1, Ordering::SeqCst);
        return Ok(());
    }
    let result = tauri::async_runtime::spawn_blocking(move || play_bytes(data))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    PLAYING.fetch_sub(1, Ordering::SeqCst);
    if let Err(error) = &result {
        log::warn!("Agent sound failed: {error}");
    }
    result
}

fn play_bytes(data: &[u8]) -> Result<(), String> {
    let path = std::env::temp_dir().join(format!(
        "concors-sound-{}-{}.mp3",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = std::fs::File::create(&path).and_then(|mut file| file.write_all(data));
    let result = written
        .map_err(|error| error.to_string())
        .and_then(|()| play_file(&path));
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(target_os = "macos")]
fn play_file(path: &Path) -> Result<(), String> {
    run(Command::new("afplay").arg(path))
}

#[cfg(windows)]
fn play_file(path: &Path) -> Result<(), String> {
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
        .creation_flags(CREATE_NO_WINDOW))
}

#[cfg(windows)]
const WINDOWS_PLAYER: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$resolved = (Resolve-Path -LiteralPath $env:CONCORS_SOUND_PATH).ProviderPath
$script:player = [System.Windows.Media.MediaPlayer]::new()
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
fn play_file(path: &Path) -> Result<(), String> {
    // Never bare aplay: it does not decode MP3 and plays the bytes as raw PCM noise.
    const PLAYERS: &[(&str, &[&str])] = &[
        ("paplay", &[]),
        ("pw-play", &[]),
        ("ffplay", &["-nodisp", "-autoexit", "-loglevel", "quiet"]),
        ("mpg123", &["-q"]),
        ("mpv", &["--no-video", "--really-quiet"]),
    ];
    let mut errors = Vec::new();
    for (program, args) in PLAYERS {
        match run(Command::new(program).args(*args).arg(path)) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(format!("{program}: {error}")),
        }
    }
    Err(format!(
        "No audio player could play the sound ({})",
        errors.join("; ")
    ))
}

fn run(command: &mut Command) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("exited with {status}")),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timed out".into());
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}
