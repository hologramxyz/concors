//! This computer's SSH key for connecting to Concors machines from its own terminal.
//!
//! Concors manages machines with its own key, so this exists only for direct `ssh`. The key is
//! created on this computer, on request, and its private half never leaves it; only the public key
//! is registered with the account. One key per device means a lost laptop is revoked on its own.
//!
//! Generation uses the system's `ssh-keygen` rather than cryptography code in the app: anyone who
//! connects over SSH already has OpenSSH, and its output is guaranteed to be a key `ssh` accepts.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const KEY_FILE: &str = "concors_ed25519";
/// Serialises creation, so two concurrent requests never race `ssh-keygen` over the same file.
static KEY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSshKey {
    /// `<type> <base64>`, the form the API stores.
    public_key: String,
    /// Absolute path of the private key, for `ssh -i`.
    path: String,
    /// Label for registering the key, so each device is recognisable in the key list.
    device_name: String,
}

/// Returns this computer's key, creating it first when `create` is set. `None` when there is no key
/// and `create` is not set, so merely looking never writes to `~/.ssh`.
#[tauri::command]
pub async fn device_ssh_key(app: AppHandle, create: bool) -> Result<Option<DeviceSshKey>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || load_or_create(&home.join(".ssh"), create))
        .await
        .map_err(|e| e.to_string())?
}

fn load_or_create(ssh_dir: &Path, create: bool) -> Result<Option<DeviceSshKey>, String> {
    let _guard = KEY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = ssh_dir.join(KEY_FILE);
    if !path.exists() {
        if !create {
            return Ok(None);
        }
        create_private_dir(ssh_dir)?;
        let name = device_name();
        // Never overwrites: this branch only runs when no key file exists.
        run(ssh_keygen()
            .args(["-q", "-t", "ed25519", "-N", "", "-C"])
            .arg(format!("concors@{name}"))
            .arg("-f")
            .arg(&path))?;
    }
    // Derived from the private key, so a missing or edited `.pub` file cannot mislead us.
    let printed = run(ssh_keygen().args(["-y", "-P", "", "-f"]).arg(&path)).map_err(|_| {
        format!(
            "{} exists but could not be read. If it has a passphrase, remove it or move the file aside.",
            path.display()
        )
    })?;
    let public_key = normalise_public_key(&printed)
        .ok_or_else(|| format!("{} is not an SSH private key", path.display()))?;
    Ok(Some(DeviceSshKey {
        public_key,
        path: path_string(&path),
        device_name: device_name(),
    }))
}

fn ssh_keygen() -> Command {
    let mut command = windowless("ssh-keygen");
    // No prompt may ever block: a passphrase or overwrite question must fail instead.
    command.stdin(Stdio::null());
    command
}

/// A console program started from this GUI app flashes a console window on Windows unless told not
/// to; these run on their own and print nothing a person needs to see.
fn windowless(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn run(command: &mut Command) -> Result<String, String> {
    let output = command.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "OpenSSH is not installed on this computer. Install it to connect to machines over SSH."
                .to_string()
        } else {
            e.to_string()
        }
    })?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `<type> <base64>` from `ssh-keygen -y` output, dropping any comment.
fn normalise_public_key(printed: &str) -> Option<String> {
    let mut fields = printed.split_whitespace();
    let kind = fields.next()?;
    let data = fields.next()?;
    let valid_kind = kind.starts_with("ssh-") || kind.starts_with("ecdsa-");
    let valid_data = data
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=');
    (valid_kind && valid_data).then(|| format!("{kind} {data}"))
}

fn device_name() -> String {
    windowless("hostname")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|name| !name.is_empty() && name.len() <= 64)
        .unwrap_or_else(|| "This computer".to_string())
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
    if dir.is_dir() {
        return Ok(());
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir).map_err(|e| e.to_string())
}

fn path_string(path: &Path) -> String {
    PathBuf::from(path).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_ssh_keygen() -> bool {
        Command::new("ssh-keygen")
            .arg("-?")
            .stdin(Stdio::null())
            .output()
            .is_ok()
    }

    fn temp_ssh_dir(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("concors-ssh-key-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(".ssh")
    }

    #[test]
    fn keeps_only_the_type_and_key_data() {
        assert_eq!(
            normalise_public_key("ssh-ed25519 AAAAC3Nza+/= concors@laptop\n"),
            Some("ssh-ed25519 AAAAC3Nza+/=".into())
        );
        assert_eq!(normalise_public_key(""), None);
        assert_eq!(normalise_public_key("not-a-key AAAA"), None);
        assert_eq!(normalise_public_key("ssh-ed25519 AAAA;rm -rf"), None);
    }

    #[test]
    fn looking_never_creates_a_key() {
        let dir = temp_ssh_dir("look");
        assert_eq!(load_or_create(&dir, false), Ok(None));
        assert!(!dir.exists(), "looking must not create ~/.ssh");
    }

    #[test]
    fn creates_one_private_key_and_reuses_it() {
        if !has_ssh_keygen() {
            eprintln!("skipped: ssh-keygen not available");
            return;
        }
        let dir = temp_ssh_dir("create");
        let first = load_or_create(&dir, true).unwrap().unwrap();
        assert!(first.public_key.starts_with("ssh-ed25519 "));
        assert_eq!(first.path, path_string(&dir.join(KEY_FILE)));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(KEY_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o077,
                0,
                "private key must not be readable by others"
            );
        }
        // Later calls, even asking to create, return the same key rather than replacing it.
        let again = load_or_create(&dir, true).unwrap().unwrap();
        assert_eq!(again.public_key, first.public_key);
        // An edited public key file cannot change what is registered.
        std::fs::write(
            dir.join(format!("{KEY_FILE}.pub")),
            "ssh-ed25519 AAAAforged",
        )
        .unwrap();
        assert_eq!(
            load_or_create(&dir, false).unwrap().unwrap().public_key,
            first.public_key
        );
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn refuses_to_touch_a_key_it_cannot_read() {
        if !has_ssh_keygen() {
            eprintln!("skipped: ssh-keygen not available");
            return;
        }
        let dir = temp_ssh_dir("locked");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(KEY_FILE);
        let status = Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "a passphrase", "-f"])
            .arg(&path)
            .stdin(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let before = std::fs::read(&path).unwrap();

        let error = load_or_create(&dir, true).unwrap_err();
        assert!(error.contains("passphrase"), "{error}");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            before,
            "an existing key must never be replaced"
        );
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }
}
