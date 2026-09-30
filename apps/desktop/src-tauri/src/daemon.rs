//! Starts the runtime shipped in the desktop bundle and reports its actual listening port.
//! Only the gateway belongs to the window; the detached session host preserves terminals on exit.

use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LocalDaemonStatus {
    NotBundled,
    Stopped,
    Running { pid: u32, port: u16 },
}

struct RunningDaemon {
    child: Child,
    port: u16,
    /// Identity this gateway was started for; a different one needs its own data partition.
    profile: Profile,
}

/// Control-plane origin plus signed-in user id. Selects the daemon's data directory; it is a
/// partition key, not a credential (the loopback gateway authenticates nothing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    origin: String,
    user: String,
}

#[derive(Default)]
pub struct LocalDaemon {
    child: Mutex<Option<RunningDaemon>>,
}

impl LocalDaemon {
    fn running(child: &mut Option<RunningDaemon>) -> Option<LocalDaemonStatus> {
        let process = child.as_mut()?;
        match process.child.try_wait() {
            Ok(None) => Some(LocalDaemonStatus::Running {
                pid: process.child.id(),
                port: process.port,
            }),
            result => {
                log::info!("local gateway exited: {result:?}");
                *child = None;
                None
            }
        }
    }

    fn start(&self, app: &AppHandle, profile: Profile) -> Result<LocalDaemonStatus, String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(status) = Self::running(&mut child) {
            // Reuse the gateway only while it serves the account that is signed in now.
            if child.as_ref().is_some_and(|d| d.profile == profile) {
                return Ok(status);
            }
            if let Some(mut previous) = child.take() {
                let _ = previous.child.kill();
                let _ = previous.child.wait();
            }
        }
        let Some(path) = bundled_daemon_path(app) else {
            return Ok(LocalDaemonStatus::NotBundled);
        };
        let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
        let log_path = logs.join("local-daemon.log");
        let running = launch(&path, &log_path, &profile, Duration::from_secs(15))?;
        let status = LocalDaemonStatus::Running {
            pid: running.child.id(),
            port: running.port,
        };
        *child = Some(running);
        Ok(status)
    }

    pub fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut process) = child.take() {
                // Killing this gateway only detaches clients; its persistent host owns the PTYs.
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
        }
    }
}

fn ready_port(line: &str) -> Option<u16> {
    if !line.starts_with("concors-daemon ") {
        return None;
    }
    let (_, address) = line.split_once(" ready at http://127.0.0.1:")?;
    address.trim().parse::<u16>().ok().filter(|port| *port > 0)
}

fn launch(
    path: &Path,
    log_path: &Path,
    profile: &Profile,
    timeout: Duration,
) -> Result<RunningDaemon, String> {
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;
    let stderr = output.try_clone().map_err(|e| e.to_string())?;
    let mut command = Command::new(path);
    for (name, value) in appimage_overrides() {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    let mut child = command
        .args([
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--log-level",
            "info",
        ])
        // A desktop process must never inherit a managed VPS binding/configuration.
        .env_remove("CONCORS_DAEMON_MANAGED_CONFIG")
        .env("CONCORS_PROFILE_ORIGIN", &profile.origin)
        .env("CONCORS_PROFILE_USER", &profile.user)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(stderr)
        .spawn()
        .map_err(|e| format!("Could not start local runtime: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Local runtime output is unavailable")?;
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = writeln!(output, "{line}");
            if let Some(port) = ready_port(&line) {
                let _ = send.try_send(port);
            }
        }
    });
    // The gateway prints readiness only after both its listener and persistent host are ready.
    match receive.recv_timeout(timeout) {
        Ok(port) if matches!(child.try_wait(), Ok(None)) => Ok(RunningDaemon {
            child,
            port,
            profile: profile.clone(),
        }),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "Local runtime did not become ready. See {}",
                log_path.display()
            ))
        }
    }
}

/// Set by the AppImage runtime and its launch scripts without pointing anywhere, so they cannot be
/// recognised by their value: which image is running, and the GTK and Python settings the image's
/// own libraries need. Each overwrote whatever the person had, so there is nothing to restore.
const APPIMAGE_ONLY: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GDK_BACKEND",
    "GTK_THEME",
    "PYTHONDONTWRITEBYTECODE",
];

/// The environment changes that give the daemon the person's environment rather than the image's.
///
/// An AppImage's launch scripts point library, Python, GTK and GStreamer search paths into the
/// image so the app finds what it bundles. The daemon needs none of it, and every terminal and
/// agent it starts would inherit it: `PYTHONHOME` alone breaks every Python in every terminal, and
/// `LD_LIBRARY_PATH` hands system programs the image's libraries. So entries inside `appdir` are
/// dropped from each variable, a variable left with nothing is removed, and the ones the image set
/// outright ([`APPIMAGE_ONLY`]) are removed too. Returns `(name, None)` for a removal.
pub fn appimage_environment(
    variables: impl IntoIterator<Item = (OsString, OsString)>,
    appdir: &Path,
) -> Vec<(OsString, Option<OsString>)> {
    let mut changes = Vec::new();
    for (name, value) in variables {
        if APPIMAGE_ONLY.iter().any(|only| OsStr::new(only) == name) {
            changes.push((name, None));
            continue;
        }
        let Some(text) = value.to_str() else { continue };
        let entries: Vec<&str> = text.split(':').collect();
        if !entries
            .iter()
            .any(|entry| !entry.is_empty() && Path::new(entry).starts_with(appdir))
        {
            continue;
        }
        let kept: Vec<&str> = entries
            .into_iter()
            .filter(|entry| !entry.is_empty() && !Path::new(entry).starts_with(appdir))
            .collect();
        let replacement = (!kept.is_empty()).then(|| OsString::from(kept.join(":")));
        changes.push((name, replacement));
    }
    changes
}

/// [`appimage_environment`] for this process, when it is running from an AppImage.
fn appimage_overrides() -> Vec<(OsString, Option<OsString>)> {
    let (Ok(executable), Some(appdir)) = (std::env::current_exe(), std::env::var_os("APPDIR"))
    else {
        return Vec::new();
    };
    let appimage = std::env::var_os("APPIMAGE");
    if crate::update::running_appimage(&executable, appimage.as_deref(), Some(&appdir)).is_none() {
        return Vec::new();
    }
    appimage_environment(std::env::vars_os(), Path::new(&appdir))
}

fn bundled_daemon_path(app: &AppHandle) -> Option<PathBuf> {
    let runtime = if cfg!(windows) {
        "daemon/bin/concors-daemon.exe"
    } else {
        "daemon/bin/concors-daemon"
    };
    let resource = app.path().resource_dir().ok()?.join(runtime);
    if resource.is_file() {
        return Some(resource);
    }
    // Older development setups placed a standalone sidecar alongside the app executable.
    let executable = std::env::current_exe().ok()?;
    let legacy = executable.parent()?.join(if cfg!(windows) {
        "concors-daemon.exe"
    } else {
        "concors-daemon"
    });
    legacy.is_file().then_some(legacy)
}

#[tauri::command]
pub fn local_daemon_status(
    app: AppHandle,
    daemon: State<'_, LocalDaemon>,
) -> Result<LocalDaemonStatus, String> {
    let mut child = daemon.child.lock().map_err(|e| e.to_string())?;
    Ok(LocalDaemon::running(&mut child).unwrap_or_else(|| {
        if bundled_daemon_path(&app).is_some() {
            LocalDaemonStatus::Stopped
        } else {
            LocalDaemonStatus::NotBundled
        }
    }))
}

#[tauri::command]
pub async fn start_local_daemon(
    app: AppHandle,
    origin: String,
    user: String,
) -> Result<LocalDaemonStatus, String> {
    if origin.trim().is_empty() || user.trim().is_empty() {
        return Err("A signed-in account is required to start the local runtime".into());
    }
    let profile = Profile {
        origin: origin.trim().to_string(),
        user: user.trim().to_string(),
    };
    tauri::async_runtime::spawn_blocking(move || app.state::<LocalDaemon>().start(&app, profile))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn stop_local_daemon(daemon: State<'_, LocalDaemon>) -> Result<LocalDaemonStatus, String> {
    daemon.shutdown();
    Ok(LocalDaemonStatus::Stopped)
}

#[cfg(test)]
mod tests {
    use super::{appimage_environment, ready_port, Profile};
    use std::ffi::OsString;
    use std::path::Path;

    fn profile() -> Profile {
        Profile {
            origin: "https://api.concors.dev".into(),
            user: "user_1".into(),
        }
    }

    #[test]
    fn readiness_requires_a_loopback_address_and_real_port() {
        assert_eq!(
            ready_port("concors-daemon 0.3.0 ready at http://127.0.0.1:49321\n"),
            Some(49321)
        );
        for invalid in [
            "ready at http://127.0.0.1:7420",
            "concors-daemon 0.3.0 ready at http://0.0.0.0:7420",
            "concors-daemon 0.3.0 ready at http://127.0.0.1:0",
            "concors-daemon 0.3.0 ready at http://127.0.0.1:99999",
        ] {
            assert_eq!(ready_port(invalid), None);
        }
    }
    #[cfg(unix)]
    #[test]
    fn startup_failure_is_bounded_and_does_not_claim_a_running_gateway() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use std::time::{Duration, Instant};
        let root = std::env::temp_dir().join(format!("concors-launch-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let script = root.join("daemon");
        fs::write(&script, "#!/bin/sh\nexec sleep 10\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let start = Instant::now();
        assert!(super::launch(
            &script,
            &root.join("log"),
            &profile(),
            Duration::from_millis(100)
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        fs::write(&script, "#!/bin/sh\nexit 1\n").unwrap();
        assert!(super::launch(
            &script,
            &root.join("log"),
            &profile(),
            Duration::from_secs(1)
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    /// What the AppImage's AppRun and GTK hook actually set, as recorded from a release build.
    #[test]
    fn an_appimage_leaves_its_own_search_paths_out_of_the_daemon() {
        let appdir = "/tmp/.mount_ConcorAbC123";
        let variables = [
            (
                "PATH",
                format!("{appdir}/usr/bin/:{appdir}/usr/sbin/:/usr/local/bin:/usr/bin"),
            ),
            (
                "LD_LIBRARY_PATH",
                format!("{appdir}/usr/lib/:{appdir}/lib64/:"),
            ),
            ("PYTHONHOME", format!("{appdir}/usr/")),
            (
                "XDG_DATA_DIRS",
                format!("{appdir}/usr/share/:{appdir}/usr/share:/usr/share:"),
            ),
            ("GTK_PATH", format!("{appdir}//usr/lib/gtk-3.0")),
            ("GDK_BACKEND", "x11".into()),
            ("APPIMAGE", "/home/someone/Concors.AppImage".into()),
            ("APPDIR", appdir.into()),
            ("HOME", "/home/someone".into()),
            ("DISPLAY", ":0".into()),
            // Not inside the mount, however similar the name.
            ("EDITOR_PATH", "/tmp/.mount_ConcorAbC1234/usr/bin".into()),
        ]
        .map(|(name, value)| (OsString::from(name), OsString::from(value)));
        let mut changes = appimage_environment(variables, Path::new(appdir));
        changes.sort();
        let expected: Vec<(OsString, Option<OsString>)> = [
            ("APPDIR", None),
            ("APPIMAGE", None),
            ("GDK_BACKEND", None),
            ("GTK_PATH", None),
            ("LD_LIBRARY_PATH", None),
            ("PATH", Some("/usr/local/bin:/usr/bin")),
            ("PYTHONHOME", None),
            ("XDG_DATA_DIRS", Some("/usr/share")),
        ]
        .into_iter()
        .map(|(name, value)| (name.into(), value.map(OsString::from)))
        .collect();
        assert_eq!(changes, expected);
    }

    #[test]
    fn identity_decides_whether_a_running_gateway_can_be_reused() {
        let prod = profile();
        assert_eq!(prod, profile());
        // A different account on the same control plane needs its own data partition.
        assert_ne!(
            prod,
            Profile {
                origin: "https://api.concors.dev".into(),
                user: "user_2".into(),
            }
        );
        // So does the same user against a different control plane.
        assert_ne!(
            prod,
            Profile {
                origin: "http://localhost:3000".into(),
                user: "user_1".into(),
            }
        );
    }
}
