//! Replacing this copy of Concors with a newer published build.
//!
//! Two things are native here. The first is recognising how this copy was installed, because that
//! decides whether the app can update itself at all: a package under `/opt` belongs to the system
//! package manager and needs an administrator, while a tree unpacked in a home directory is ours
//! to replace. The second is applying an update, which means touching files the webview cannot.
//!
//! Downloading and verifying use the system's `curl` and `sha256sum` rather than HTTP and digest
//! crates, for the same reason `ssh_key.rs` uses `ssh-keygen`: they are present wherever this app
//! runs, and their behaviour around redirects and proxies is the one users already configured.
//! `curl` is told not to carry our credential across a redirect, so the session token reaches the
//! control plane and never the host storing the build.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Serialises updates, so a double click cannot start two installs of the same package.
static UPDATE_LOCK: Mutex<()> = Mutex::new(());

/// How this copy of Concors got onto the computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Installation {
    /// The system package manager owns the files; updating needs an administrator.
    Pacman { package: String },
    /// A relocatable tree we can replace ourselves, if its files are writable.
    Tarball { root: String, writable: bool },
    /// Built from a checkout. Nothing is offered: the checkout is the source of truth.
    Development,
    /// Somewhere we do not recognise; the app can still say a version exists.
    Unknown,
}

impl Installation {
    /// Release formats this copy can install, best first. Empty means "tell them, do not offer".
    fn formats(&self) -> &'static [&'static str] {
        match self {
            Installation::Pacman { .. } => &["pacman"],
            Installation::Tarball { writable: true, .. } => &["tarball"],
            _ => &[],
        }
    }
}

/// Where this executable lives decides everything else, so it is read once and reasoned about here.
pub fn detect(executable: &Path, owner: impl FnOnce(&Path) -> Option<String>) -> Installation {
    let path = executable.to_string_lossy();
    // `cargo build` and `tauri dev` both land here; neither is a published build.
    if path.contains("/target/debug/") || path.contains("/target/release/") {
        return Installation::Development;
    }
    if let Some(package) = owner(executable) {
        return Installation::Pacman { package };
    }
    // The published tree is `<root>/bin/concors-desktop` next to `<root>/lib/Concors`.
    if let Some(root) = executable.parent().and_then(Path::parent) {
        if root.join("lib/Concors").is_dir() {
            return Installation::Tarball {
                root: root.to_string_lossy().into_owned(),
                writable: is_writable(root),
            };
        }
    }
    Installation::Unknown
}

/// Asks the filesystem rather than the permission bits: a tree under `/opt` is typically
/// root-owned and mode 755, which says "writable" to everyone but this process.
fn is_writable(path: &Path) -> bool {
    let probe = path.join(".concors-update-probe");
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The pacman package owning `executable`, when pacman is installed and knows about it.
fn pacman_owner(executable: &Path) -> Option<String> {
    let output = Command::new("pacman")
        .arg("-Qoq")
        .arg(executable)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!name.is_empty()).then_some(name)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationReport {
    #[serde(flatten)]
    installation: Installation,
    /// Formats to ask the control plane about; empty when this copy does not take updates.
    formats: Vec<String>,
    /// `linux`, `darwin` or `windows`, as the control plane names them.
    platform: String,
    arch: String,
}

/// Rust's name for this target, translated to the one releases are published under.
fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    }
}

/// How this copy was installed, and therefore what it can be updated with.
#[tauri::command]
pub fn app_installation() -> InstallationReport {
    let installation = match std::env::current_exe() {
        Ok(executable) => detect(&executable, pacman_owner),
        Err(error) => {
            log::warn!("could not locate the running executable: {error}");
            Installation::Unknown
        }
    };
    let formats = installation
        .formats()
        .iter()
        .map(|format| (*format).to_owned())
        .collect();
    InstallationReport {
        installation,
        formats,
        platform: platform().to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequest {
    /// Control-plane URL of the build; it redirects to wherever the release is stored.
    url: String,
    /// Lowercase hex SHA-256 the download must have.
    sha256: String,
    /// Release format, which must be one this installation can apply.
    format: String,
    /// Session token for the control plane. Never written to the command line.
    token: String,
    /// Version being installed; used for the downloaded file's name only.
    version: String,
}

/// Downloads the build, checks it, installs it and restarts into it. Never returns on success.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, request: UpdateRequest) -> Result<(), String> {
    let installation = app_installation().installation;
    if !installation.formats().contains(&request.format.as_str()) {
        return Err(format!(
            "This copy of Concors cannot install a {} build.",
            request.format
        ));
    }
    if request.sha256.len() != 64 || !request.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("The update has no usable checksum.".into());
    }

    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || apply(&installation, &request))
        .await
        .map_err(|error| error.to_string())??;
    handle.restart();
}

fn apply(installation: &Installation, request: &UpdateRequest) -> Result<(), String> {
    let _guard = UPDATE_LOCK.lock().map_err(|error| error.to_string())?;
    let directory = std::env::temp_dir().join(format!("concors-update-{}", std::process::id()));
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not stage the update: {error}"))?;
    let result = download_and_install(installation, request, &directory);
    // The build is large; leaving it behind after a failed update helps nobody.
    let _ = fs::remove_dir_all(&directory);
    result
}

fn download_and_install(
    installation: &Installation,
    request: &UpdateRequest,
    directory: &Path,
) -> Result<(), String> {
    let name = match installation {
        Installation::Pacman { .. } => format!("concors-{}.pkg.tar.zst", request.version),
        _ => format!("concors-{}.tar.gz", request.version),
    };
    let file = directory.join(name);
    download(&request.url, &request.token, &file)?;
    verify(&file, &request.sha256)?;
    match installation {
        Installation::Pacman { .. } => install_package(&file),
        Installation::Tarball { root, .. } => replace_tree(&file, Path::new(root)),
        _ => Err("This copy of Concors cannot install updates.".into()),
    }
}

/// `curl` reads the credential from a config on stdin, so it never appears in the process list.
fn download(url: &str, token: &str, destination: &Path) -> Result<(), String> {
    use std::io::Write;

    let mut child = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            // Our token is for the control plane. A redirect leads elsewhere, and curl drops the
            // header on its own unless told otherwise; this says plainly that it must.
            "--no-location-trusted",
            "--retry",
            "2",
            "--config",
            "-",
            "--output",
        ])
        .arg(destination)
        .arg(url)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run curl to download the update: {error}"))?;

    child
        .stdin
        .take()
        .ok_or("curl did not accept its configuration")?
        .write_all(format!("header = \"authorization: Bearer {token}\"\n").as_bytes())
        .map_err(|error| format!("Could not pass the download credential: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Downloading the update failed: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Downloading the update failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn verify(file: &Path, sha256: &str) -> Result<(), String> {
    let output = Command::new("sha256sum")
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not check the download: {error}"))?;
    let digest = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_owned();
    if !output.status.success() || digest != sha256 {
        return Err("The downloaded update did not match its checksum and was discarded.".into());
    }
    Ok(())
}

/// pacman keeps its own record of what is installed, so an update must go through it.
fn install_package(file: &Path) -> Result<(), String> {
    let output = Command::new("pkexec")
        .args(["pacman", "-U", "--noconfirm"])
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not ask for administrator access: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    // 126 is polkit's "dismissed or not authorised"; anything else is pacman's own failure.
    if output.status.code() == Some(126) {
        return Err("Administrator access was not granted, so nothing changed.".into());
    }
    Err(format!(
        "Installing the update failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

/// Unpacks next to the current tree and swaps, so a failed extraction leaves the app runnable.
fn replace_tree(archive: &Path, root: &Path) -> Result<(), String> {
    let staging = root.with_extension("update");
    let previous = root.with_extension("old");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|error| format!("Could not stage the update: {error}"))?;

    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&staging)
        .arg("--strip-components=1")
        .stdin(Stdio::null())
        .status()
        .map_err(|error| format!("Could not unpack the update: {error}"))?;
    if !status.success() {
        let _ = fs::remove_dir_all(&staging);
        return Err("The update could not be unpacked.".into());
    }
    if !staging.join("bin/concors-desktop").is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err("The update did not contain a Concors build.".into());
    }

    let _ = fs::remove_dir_all(&previous);
    fs::rename(root, &previous)
        .map_err(|error| format!("Could not move the old build: {error}"))?;
    if let Err(error) = fs::rename(&staging, root) {
        // Put back what was working before reporting the failure.
        let _ = fs::rename(&previous, root);
        return Err(format!("Could not put the update in place: {error}"));
    }
    let _ = fs::remove_dir_all(&previous);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("concors-update-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_checkout_build_is_never_offered_an_update() {
        let cargo = Path::new(
            "/home/someone/concors/apps/desktop/src-tauri/target/release/concors-desktop",
        );
        assert_eq!(detect(cargo, |_| None), Installation::Development);
        let debug =
            Path::new("/home/someone/concors/apps/desktop/src-tauri/target/debug/concors-desktop");
        assert_eq!(
            detect(debug, |_| Some("concors-bin".into())),
            Installation::Development
        );
        assert!(Installation::Development.formats().is_empty());
    }

    #[test]
    fn a_packaged_copy_reports_the_package_that_owns_it() {
        let installed = Path::new("/opt/Concors/bin/concors-desktop");
        assert_eq!(
            detect(installed, |_| Some("concors-bin".into())),
            Installation::Pacman {
                package: "concors-bin".into()
            }
        );
        assert_eq!(
            Installation::Pacman {
                package: "concors-bin".into()
            }
            .formats(),
            &["pacman"]
        );
    }

    #[test]
    fn an_unpacked_tree_is_recognised_by_its_layout() {
        let root = temp("tree");
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::create_dir_all(root.join("lib/Concors")).unwrap();
        let executable = root.join("bin/concors-desktop");
        fs::write(&executable, "").unwrap();

        assert_eq!(
            detect(&executable, |_| None),
            Installation::Tarball {
                root: root.to_string_lossy().into_owned(),
                writable: true
            }
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_binary_on_its_own_is_not_mistaken_for_an_installation() {
        let root = temp("loose");
        fs::create_dir_all(root.join("bin")).unwrap();
        let executable = root.join("bin/concors-desktop");
        fs::write(&executable, "").unwrap();

        assert_eq!(detect(&executable, |_| None), Installation::Unknown);
        assert!(Installation::Unknown.formats().is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_download_that_does_not_match_its_checksum_is_refused() {
        let directory = temp("verify");
        let file = directory.join("build.tar.gz");
        fs::write(&file, "not the build you asked for").unwrap();

        assert!(verify(&file, &"0".repeat(64)).is_err());
        let digest = Command::new("sha256sum").arg(&file).output().unwrap();
        let expected = String::from_utf8_lossy(&digest.stdout)
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned();
        assert!(verify(&file, &expected).is_ok());
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn replacing_a_tree_keeps_the_old_build_when_the_archive_is_not_concors() {
        let base = temp("swap");
        let root = base.join("Concors");
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/concors-desktop"), "old").unwrap();

        // An archive holding something else must not replace a working installation.
        let archive = base.join("other.tar.gz");
        let payload = base.join("payload");
        fs::create_dir_all(payload.join("stuff")).unwrap();
        fs::write(payload.join("stuff/readme"), "x").unwrap();
        Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(&payload)
            .arg("stuff")
            .status()
            .unwrap();

        assert!(replace_tree(&archive, &root).is_err());
        assert_eq!(
            fs::read_to_string(root.join("bin/concors-desktop")).unwrap(),
            "old"
        );
        fs::remove_dir_all(&base).unwrap();
    }
}
