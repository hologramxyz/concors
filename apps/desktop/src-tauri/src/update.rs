//! Replacing this copy of Concors with a newer published build.
//!
//! Two things are native here. The first is recognising how this copy was installed, because that
//! decides whether the app can update itself at all: a package under `/opt` belongs to the system
//! package manager and needs an administrator, while a tree unpacked in a home directory, or an
//! AppImage saved in one, is ours to replace. The second is applying an update, which means
//! touching files the webview cannot.
//!
//! Downloading and verifying use the system's `curl` and `sha256sum` rather than HTTP and digest
//! crates, for the same reason `ssh_key.rs` uses `ssh-keygen`: they are present wherever this app
//! runs, and their behaviour around redirects and proxies is the one users already configured.
//! `curl` is told not to carry our credential across a redirect, so the session token reaches the
//! control plane and never the host storing the build.

use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
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
    /// A single AppImage file, which we can replace ourselves if its directory is writable.
    #[serde(rename = "appimage")]
    AppImage { path: String, writable: bool },
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
            Installation::AppImage { writable: true, .. } => &["appimage"],
            _ => &[],
        }
    }
}

/// Where this executable lives decides everything else, so it is read once and reasoned about here.
/// `appimage` is the file this process was started from, when it was (see [`running_appimage`]).
pub fn detect(
    executable: &Path,
    appimage: Option<&Path>,
    owner: impl FnOnce(&Path) -> Option<String>,
) -> Installation {
    // Inside an AppImage the executable sits on a temporary read-only mount; what the person
    // downloaded, and what an update replaces, is the file the runtime mounted.
    if let Some(file) = appimage {
        return Installation::AppImage {
            path: file.to_string_lossy().into_owned(),
            writable: file.parent().is_some_and(is_writable),
        };
    }
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

/// The AppImage file this process was started from, if any. The AppImage runtime mounts the image
/// at `APPDIR` and names the file in `APPIMAGE`, and both are inherited by everything started from
/// inside it: a Concors launched from another AppImage's terminal sees that program's values, and
/// must not replace it with itself. Only an executable inside `APPDIR` was started from `APPIMAGE`.
pub fn running_appimage(
    executable: &Path,
    appimage: Option<&OsStr>,
    appdir: Option<&OsStr>,
) -> Option<PathBuf> {
    let (file, mount) = (Path::new(appimage?), Path::new(appdir?));
    (file.is_absolute() && mount.is_absolute() && executable.starts_with(mount))
        .then(|| file.to_path_buf())
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
        Ok(executable) => {
            let appimage = running_appimage(
                &executable,
                std::env::var_os("APPIMAGE").as_deref(),
                std::env::var_os("APPDIR").as_deref(),
            );
            detect(&executable, appimage.as_deref(), pacman_owner)
        }
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
    /// Bytes the build should have, which tells a short download apart from a wrong one.
    size: u64,
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
        Installation::AppImage { .. } => format!("concors-{}.AppImage", request.version),
        _ => format!("concors-{}.tar.gz", request.version),
    };
    let file = directory.join(name);
    download(&request.url, &request.token, &file)?;
    verify(&file, &request.sha256, request.size)?;
    match installation {
        Installation::Pacman { .. } => install_package(&file),
        Installation::Tarball { root, .. } => replace_tree(&file, Path::new(root)),
        // Tauri's restart relaunches `APPIMAGE`, so it starts the file that is now the new build.
        Installation::AppImage { path, .. } => replace_appimage(&file, Path::new(path)),
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
            // Follow the control plane's redirect to wherever the build is stored. curl sends the
            // credential below to the first host only and drops it on a cross-host redirect, which
            // is exactly what we want here. `--no-location-trusted` is NOT the careful spelling of
            // that: it cancels following redirects altogether, and curl then writes the empty body
            // of the 302 and exits successfully, leaving a 0-byte "build".
            "--location",
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
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        log::warn!("update download failed: {reason}");
        return Err(format!("Downloading the update failed: {reason}"));
    }
    log::info!(
        "downloaded update: {} bytes",
        fs::metadata(destination)
            .map(|meta| meta.len())
            .unwrap_or(0)
    );
    Ok(())
}

fn verify(file: &Path, sha256: &str, expected_size: u64) -> Result<(), String> {
    // Length first: a transfer that stopped early is a different problem from one that arrived
    // changed, and saying so is the difference between "try again" and "something is wrong".
    let actual_size = fs::metadata(file).map(|meta| meta.len()).unwrap_or(0);
    if expected_size > 0 && actual_size != expected_size {
        log::warn!("update download is {actual_size} bytes, expected {expected_size}");
        return Err(format!(
            "The update downloaded incompletely ({actual_size} of {expected_size} bytes) and was discarded."
        ));
    }

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
        log::warn!("update digest {digest} does not match the published {sha256}");
        return Err("The downloaded update did not match its checksum and was discarded.".into());
    }
    log::info!("update verified: {actual_size} bytes, sha256 {sha256}");
    Ok(())
}

/// pacman keeps its own record of what is installed, so an update must go through it.
fn install_package(file: &Path) -> Result<(), String> {
    log::info!("installing {} with pacman", file.display());
    let output = Command::new("pkexec")
        .args(["pacman", "-U", "--noconfirm"])
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not ask for administrator access: {error}"))?;
    if output.status.success() {
        log::info!("update installed; restarting");
        return Ok(());
    }
    log::warn!(
        "pacman exited {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
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

/// Copies the new image beside the running one and renames it over it. The rename is what makes
/// this safe while the old image runs: its mount keeps reading the file it opened, which lives on
/// unnamed until the app exits, while the name now belongs to the new build. Writing into the
/// running file instead would change the image underneath its own mount.
fn replace_appimage(download: &Path, target: &Path) -> Result<(), String> {
    if !is_appimage(download) {
        return Err("The update did not contain a Concors build.".into());
    }
    let (Some(directory), Some(name)) = (target.parent(), target.file_name()) else {
        return Err("Could not find the AppImage to replace.".into());
    };
    // Hidden, and in the same directory, since a rename cannot cross filesystems.
    let staging = directory.join(format!(".{}.update", name.to_string_lossy()));
    let result = fs::copy(download, &staging)
        .and_then(|_| {
            // Keep whatever mode the person gave the file; it is running, so it is executable.
            let permissions = fs::metadata(target)?.permissions();
            fs::set_permissions(&staging, permissions)
        })
        .and_then(|()| fs::rename(&staging, target));
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(format!("Could not put the update in place: {error}"));
    }
    Ok(())
}

/// An ELF file carrying the AppImage type 2 magic (`AI` 2) in its identification padding.
fn is_appimage(file: &Path) -> bool {
    let mut header = [0u8; 11];
    fs::File::open(file)
        .and_then(|mut opened| opened.read_exact(&mut header))
        .is_ok()
        && header.starts_with(b"\x7fELF")
        && &header[8..] == b"AI\x02"
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
        assert_eq!(detect(cargo, None, |_| None), Installation::Development);
        let debug =
            Path::new("/home/someone/concors/apps/desktop/src-tauri/target/debug/concors-desktop");
        assert_eq!(
            detect(debug, None, |_| Some("concors-bin".into())),
            Installation::Development
        );
        assert!(Installation::Development.formats().is_empty());
    }

    #[test]
    fn a_packaged_copy_reports_the_package_that_owns_it() {
        let installed = Path::new("/opt/Concors/bin/concors-desktop");
        assert_eq!(
            detect(installed, None, |_| Some("concors-bin".into())),
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
            detect(&executable, None, |_| None),
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

        assert_eq!(detect(&executable, None, |_| None), Installation::Unknown);
        assert!(Installation::Unknown.formats().is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_download_that_does_not_match_its_checksum_is_refused() {
        let directory = temp("verify");
        let file = directory.join("build.tar.gz");
        let body = "not the build you asked for";
        fs::write(&file, body).unwrap();
        let size = body.len() as u64;

        assert!(verify(&file, &"0".repeat(64), size).is_err());
        let digest = Command::new("sha256sum").arg(&file).output().unwrap();
        let expected = String::from_utf8_lossy(&digest.stdout)
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned();
        assert!(verify(&file, &expected, size).is_ok());
        fs::remove_dir_all(&directory).unwrap();
    }

    /// The failure this actually shipped with: a redirect that was never followed left an empty
    /// file, and a bare checksum mismatch said nothing about why.
    #[test]
    fn an_empty_or_short_download_says_so_rather_than_blaming_the_checksum() {
        let directory = temp("short");
        let file = directory.join("build.tar.gz");
        fs::write(&file, "").unwrap();

        let error = verify(&file, &"0".repeat(64), 48_761_820).unwrap_err();
        assert!(error.contains("downloaded incompletely"), "{error}");
        assert!(error.contains("0 of 48761820"), "{error}");

        fs::write(&file, "half").unwrap();
        assert!(verify(&file, &"0".repeat(64), 8)
            .unwrap_err()
            .contains("4 of 8"));
        fs::remove_dir_all(&directory).unwrap();
    }

    /// A release that does not publish a size must still be installable.
    #[test]
    fn an_unknown_size_falls_back_to_the_checksum_alone() {
        let directory = temp("nosize");
        let file = directory.join("build.tar.gz");
        fs::write(&file, "build").unwrap();
        let digest = Command::new("sha256sum").arg(&file).output().unwrap();
        let expected = String::from_utf8_lossy(&digest.stdout)
            .split_whitespace()
            .next()
            .unwrap()
            .to_owned();

        assert!(verify(&file, &expected, 0).is_ok());
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

    /// The start of a type 2 AppImage: an ELF identification with `AI` 2 in its padding.
    const APPIMAGE_HEADER: &[u8] = b"\x7fELF\x02\x01\x01\0AI\x02\0\0\0\0\0";

    #[test]
    fn an_appimage_is_recognised_by_the_file_its_runtime_names() {
        let directory = temp("appimage");
        let file = directory.join("Concors-linux-x86_64.AppImage");
        let executable = Path::new("/tmp/.mount_ConcorAbC123/usr/bin/concors-desktop");
        let found = running_appimage(
            executable,
            Some(file.as_os_str()),
            Some(OsStr::new("/tmp/.mount_ConcorAbC123")),
        );
        assert_eq!(found.as_deref(), Some(file.as_path()));

        // Checked before anything else: a pacman query about the mount would mean nothing.
        let installation = detect(executable, found.as_deref(), |_| Some("concors-bin".into()));
        assert_eq!(
            installation,
            Installation::AppImage {
                path: file.to_string_lossy().into_owned(),
                writable: true
            }
        );
        assert_eq!(installation.formats(), &["appimage"]);
        fs::remove_dir_all(&directory).unwrap();
    }

    /// Another AppImage's variables reach any Concors started from its terminal.
    #[test]
    fn an_appimage_variable_inherited_from_another_program_is_ignored() {
        let other = Some(OsStr::new("/home/someone/Apps/Editor.AppImage"));
        let mount = Some(OsStr::new("/tmp/.mount_EditorXyZ"));
        let tarball = Path::new("/home/someone/Concors/bin/concors-desktop");
        assert_eq!(running_appimage(tarball, other, mount), None);
        // Components, not characters: one mount's name can be the prefix of another's.
        let lookalike = Path::new("/tmp/.mount_EditorXyZ9/usr/bin/concors-desktop");
        assert_eq!(running_appimage(lookalike, other, mount), None);
        let inside = Path::new("/tmp/.mount_EditorXyZ/usr/bin/concors-desktop");
        assert_eq!(running_appimage(inside, None, mount), None);
        assert_eq!(running_appimage(inside, other, None), None);
        assert_eq!(
            running_appimage(inside, Some(OsStr::new("Editor.AppImage")), mount),
            None
        );
    }

    /// The webview's schema (`src/tauri/app-update.ts`) matches on exactly this shape.
    #[test]
    fn an_appimage_reports_the_kind_the_webview_expects() {
        let installation = Installation::AppImage {
            path: "/home/someone/Concors.AppImage".into(),
            writable: true,
        };
        assert_eq!(
            serde_json::to_value(installation).unwrap(),
            serde_json::json!({
                "kind": "appimage",
                "path": "/home/someone/Concors.AppImage",
                "writable": true
            })
        );
    }

    #[test]
    fn an_appimage_that_cannot_be_rewritten_is_only_announced() {
        let installation = Installation::AppImage {
            path: "/opt/Concors.AppImage".into(),
            writable: false,
        };
        assert!(installation.formats().is_empty());
    }

    #[test]
    fn replacing_an_appimage_swaps_the_file_under_the_running_one() {
        let directory = temp("appimage-swap");
        let target = directory.join("Concors.AppImage");
        fs::write(&target, [APPIMAGE_HEADER, b"old"].concat()).unwrap();
        let download = directory.join("download");
        let new = [APPIMAGE_HEADER, b"new"].concat();
        fs::write(&download, &new).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o750)).unwrap();
        }
        // What the running image's mount holds on to.
        let mut running = fs::File::open(&target).unwrap();

        replace_appimage(&download, &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), new);
        let mut old = Vec::new();
        running.read_to_end(&mut old).unwrap();
        assert!(
            old.ends_with(b"old"),
            "the running image changed underneath it"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&target).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o750);
        }
        let mut left = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        left.sort();
        assert_eq!(left, ["Concors.AppImage", "download"]);
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn replacing_an_appimage_keeps_the_old_one_when_the_download_is_not_one() {
        let directory = temp("appimage-refuse");
        let target = directory.join("Concors.AppImage");
        fs::write(&target, [APPIMAGE_HEADER, b"old"].concat()).unwrap();
        let download = directory.join("download");
        // An ELF file, but not an AppImage.
        fs::write(&download, b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0rest").unwrap();

        assert!(replace_appimage(&download, &target).is_err());
        assert_eq!(
            fs::read(&target).unwrap(),
            [APPIMAGE_HEADER, b"old"].concat()
        );
        assert!(!directory.join(".Concors.AppImage.update").exists());
        fs::remove_dir_all(&directory).unwrap();
    }
}
