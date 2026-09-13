//! Starts the runtime shipped in the desktop bundle and reports its actual listening port.
//! Only the gateway belongs to the window; the detached session host preserves terminals on exit.

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

    fn start(&self, app: &AppHandle) -> Result<LocalDaemonStatus, String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(status) = Self::running(&mut child) {
            return Ok(status);
        }
        let Some(path) = bundled_daemon_path(app) else {
            return Ok(LocalDaemonStatus::NotBundled);
        };
        let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
        let log_path = logs.join("local-daemon.log");
        let running = launch(&path, &log_path, Duration::from_secs(15))?;
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

fn launch(path: &Path, log_path: &Path, timeout: Duration) -> Result<RunningDaemon, String> {
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| e.to_string())?;
    let stderr = output.try_clone().map_err(|e| e.to_string())?;
    let mut child = Command::new(path)
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
        Ok(port) if matches!(child.try_wait(), Ok(None)) => Ok(RunningDaemon { child, port }),
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
pub async fn start_local_daemon(app: AppHandle) -> Result<LocalDaemonStatus, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LocalDaemon>().start(&app))
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
    use super::ready_port;

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
        assert!(super::launch(&script, &root.join("log"), Duration::from_millis(100)).is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        fs::write(&script, "#!/bin/sh\nexit 1\n").unwrap();
        assert!(super::launch(&script, &root.join("log"), Duration::from_secs(1)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
