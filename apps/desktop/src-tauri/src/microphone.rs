//! Microphone access for dictation.
//!
//! WebKitGTK denies every `getUserMedia` call unless the embedder answers its permission request,
//! and wry does not, so on Linux dictation could never hear the user. This grants audio-only
//! capture to the app's own page. Camera and screen capture stay denied; iframes need an explicit
//! `allow="microphone"` from the app before WebKit asks at all.

#[cfg(target_os = "linux")]
pub fn allow(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::object::Cast;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    let result = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(|_, request| {
            let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                return false;
            };
            if media.is_for_audio_device() && !media.is_for_video_device() {
                media.allow();
            } else {
                media.deny();
            }
            true
        });
    });
    if let Err(error) = result {
        log::warn!("microphone access unavailable: {error}");
    }
}

/// WKWebView asks macOS itself, using the usage description in Info.plist.
#[cfg(not(target_os = "linux"))]
pub fn allow(_window: &tauri::WebviewWindow) {}
