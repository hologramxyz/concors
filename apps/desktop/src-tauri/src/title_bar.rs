//! Double-clicking the unified macOS title bar.
//!
//! The window draws its own title bar over the content, so the webview receives the double-click.
//! Tauri's drag region would always maximize; this follows System Settings › Desktop & Dock ›
//! "Double-click a window's title bar to" instead.

#[tauri::command]
pub fn title_bar_double_click(window: tauri::WebviewWindow) -> Result<(), String> {
    let result = match double_click_action().as_deref() {
        Some("Minimize") => window.minimize(),
        Some("None") => Ok(()),
        // "Maximize" (Zoom), "Fill", and unset all grow the window or put it back.
        _ => match window.is_maximized() {
            Ok(true) => window.unmaximize(),
            Ok(false) => window.maximize(),
            Err(error) => Err(error),
        },
    };
    result.map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn double_click_action() -> Option<String> {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    if let Some(action) = defaults.stringForKey(&NSString::from_str("AppleActionOnDoubleClick")) {
        return Some(action.to_string());
    }
    // Older macOS versions only stored whether double-click minimizes.
    defaults
        .boolForKey(&NSString::from_str("AppleMiniaturizeOnDoubleClick"))
        .then(|| "Minimize".to_string())
}

#[cfg(not(target_os = "macos"))]
fn double_click_action() -> Option<String> {
    None
}
