//! Lifecycle of the *bundled* local daemon.
//!
//! The native layer knows how to find, start and stop the `concors-daemon` executable that ships
//! next to the app. It does **not** speak the Concors protocol; once the process is up, the
//! frontend connects to it over WebSocket exactly like it would to a remote daemon.
//!
//! Packaging (see `packages/daemon/README.md`) will place the executable next to the app binary via
//! Tauri's `bundle.externalBin`. Until then, dev builds report `NotBundled` and the frontend falls
//! back to a daemon started manually with `pnpm daemon:dev`.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

/// Must match `DEFAULT_LOCAL_DAEMON_PORT` in `@concors/protocol`.
const DEFAULT_PORT: u16 = 7420;
const BINARY_NAME: &str = "concors-daemon";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LocalDaemonStatus {
    /// This build ships without a daemon executable (development).
    NotBundled,
    Stopped,
    Running {
        pid: u32,
        port: u16,
    },
}

#[derive(Default)]
pub struct LocalDaemon {
    child: Mutex<Option<Child>>,
}

impl LocalDaemon {
    fn status_locked(child: &mut Option<Child>) -> LocalDaemonStatus {
        // `try_wait` reaps a daemon that died on its own so we do not report a stale pid.
        if let Some(process) = child.as_mut() {
            match process.try_wait() {
                Ok(None) => {
                    return LocalDaemonStatus::Running {
                        pid: process.id(),
                        port: DEFAULT_PORT,
                    }
                }
                Ok(Some(status)) => {
                    log::warn!("bundled daemon exited: {status}");
                    *child = None;
                }
                Err(err) => {
                    log::warn!("could not poll bundled daemon: {err}");
                    *child = None;
                }
            }
        }

        if bundled_daemon_path().is_some() {
            LocalDaemonStatus::Stopped
        } else {
            LocalDaemonStatus::NotBundled
        }
    }

    fn start(&self) -> Result<LocalDaemonStatus, String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;

        if let running @ LocalDaemonStatus::Running { .. } = Self::status_locked(&mut child) {
            return Ok(running);
        }

        let Some(path) = bundled_daemon_path() else {
            return Ok(LocalDaemonStatus::NotBundled);
        };

        log::info!("starting bundled daemon from {}", path.display());
        let process = Command::new(&path)
            .arg("serve")
            .args(["--host", "127.0.0.1"])
            .args(["--port", &DEFAULT_PORT.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|err| format!("failed to start {}: {err}", path.display()))?;

        let pid = process.id();
        *child = Some(process);
        Ok(LocalDaemonStatus::Running {
            pid,
            port: DEFAULT_PORT,
        })
    }

    fn stop(&self) -> Result<LocalDaemonStatus, String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        Self::terminate(&mut child);
        Ok(Self::status_locked(&mut child))
    }

    /// Best-effort termination used on app exit. Never panics.
    pub fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            Self::terminate(&mut child);
        }
    }

    fn terminate(child: &mut Option<Child>) {
        if let Some(mut process) = child.take() {
            // TODO: ask the daemon to shut down gracefully (SIGTERM / protocol message) before
            // resorting to kill, so it can terminate agent sessions cleanly.
            if let Err(err) = process.kill() {
                log::warn!("failed to kill bundled daemon: {err}");
            }
            let _ = process.wait();
        }
    }
}

/// Location of the bundled daemon: next to the app executable, where `externalBin` places it.
fn bundled_daemon_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let file_name = if cfg!(windows) {
        format!("{BINARY_NAME}.exe")
    } else {
        BINARY_NAME.to_string()
    };
    let path = dir.join(file_name);
    path.is_file().then_some(path)
}

#[tauri::command]
pub fn local_daemon_status(daemon: State<'_, LocalDaemon>) -> Result<LocalDaemonStatus, String> {
    let mut child = daemon.child.lock().map_err(|e| e.to_string())?;
    Ok(LocalDaemon::status_locked(&mut child))
}

#[tauri::command]
pub fn start_local_daemon(daemon: State<'_, LocalDaemon>) -> Result<LocalDaemonStatus, String> {
    daemon.start()
}

#[tauri::command]
pub fn stop_local_daemon(daemon: State<'_, LocalDaemon>) -> Result<LocalDaemonStatus, String> {
    daemon.stop()
}
