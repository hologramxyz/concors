//! Saves a file the UI hands over, such as an image an agent showed or an attachment, into the
//! Downloads folder and shows it in the file manager.
//!
//! The webview cannot do this itself: WKWebView cancels a download unless the window registers a
//! download handler, and Concors' window is declared in `tauri.conf.json`. The bytes arrive as the
//! raw request body; the file name comes percent-encoded in a header, since headers are ASCII.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Decodes the UI's `encodeURIComponent` output. Malformed escapes are kept as they are.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = (bytes[i] == b'%')
            .then(|| value.get(i + 1..i + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                decoded.push(byte);
                i += 3;
            }
            None => {
                decoded.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

/// The requested name reduced to one file name that cannot leave the Downloads folder or be
/// rejected by Windows.
fn file_name(requested: &str) -> String {
    let base = requested.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let name = cleaned
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' ']);
    if name.is_empty() {
        "download".into()
    } else {
        name.into()
    }
}

/// Writes `bytes` to a new file in `directory`, numbering the name as browsers do
/// (`image (1).png`) rather than replacing a file already there.
fn write_new(directory: &Path, name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|e| e.to_str());
    for n in 0..1000 {
        let candidate = match (n, extension) {
            (0, _) => name.to_string(),
            (_, Some(extension)) => format!("{stem} ({n}).{extension}"),
            (_, None) => format!("{stem} ({n})"),
        };
        let target = directory.join(candidate);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        return Ok(target);
    }
    Err(std::io::Error::new(
        ErrorKind::AlreadyExists,
        "too many files with this name",
    ))
}

/// Saves the request body into Downloads and returns where it went.
#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file arrived in an unexpected format.".into());
    };
    let requested = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "Could not find your Downloads folder.".to_string())?;
    let path = write_new(&directory, &file_name(&requested), bytes)
        .map_err(|error| format!("Could not save to Downloads: {error}"))?;
    // Showing the file is a convenience; it is saved either way.
    if let Err(error) = tauri_plugin_opener::reveal_item_in_dir(&path) {
        log::warn!(
            "Could not show {} in the file manager: {error}",
            path.display()
        );
    }
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_names_the_ui_encoded() {
        assert_eq!(
            percent_decode("Always-on%20banner.png"),
            "Always-on banner.png"
        );
        assert_eq!(percent_decode("caf%C3%A9.txt"), "café.txt");
        assert_eq!(percent_decode("100%.txt"), "100%.txt");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn keeps_names_inside_downloads() {
        assert_eq!(file_name("banner.png"), "banner.png");
        assert_eq!(file_name("../../.ssh/authorized_keys"), "authorized_keys");
        assert_eq!(file_name("C:\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(file_name("what?: a <plan>.md"), "what a plan.md");
        assert_eq!(file_name(".."), "download");
        assert_eq!(file_name(""), "download");
        assert_eq!(file_name("notes. "), "notes");
    }

    #[test]
    fn numbers_a_name_already_taken_instead_of_replacing_it() {
        let directory =
            std::env::temp_dir().join(format!("concors-downloads-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let first = write_new(&directory, "banner.png", b"first").unwrap();
        let second = write_new(&directory, "banner.png", b"second").unwrap();
        let bare = write_new(&directory, "notes", b"a").unwrap();
        let bare_again = write_new(&directory, "notes", b"b").unwrap();
        assert_eq!(first.file_name().unwrap(), "banner.png");
        assert_eq!(second.file_name().unwrap(), "banner (1).png");
        assert_eq!(bare_again.file_name().unwrap(), "notes (1)");
        assert_eq!(fs::read(&first).unwrap(), b"first");
        assert_eq!(fs::read(&second).unwrap(), b"second");
        assert_eq!(fs::read(&bare).unwrap(), b"a");
        fs::remove_dir_all(&directory).unwrap();
    }
}
