//! Native delivery and click callbacks. Agent state and policy stay in TypeScript/the daemon.
//!
//! On macOS, notify-rust posts through NSUserNotificationCenter, which reports success even when
//! the system drops the banner because Concors is not allowed to show one. Delivery therefore checks
//! the permission UNUserNotificationCenter reports first, asks for it the first time, and turns a
//! refusal into an error the app can show instead of a notification that silently never appears.
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

const BLOCKED: &str = "macOS isn’t allowing Concors to show notifications. Turn on Allow notifications in System Settings → Notifications → Concors.";

#[derive(Default)]
pub struct Notifications {
    tickets: Mutex<HashMap<String, Arc<AtomicBool>>>,
    workers: Arc<AtomicUsize>,
}

/// Whether the operating system shows Concors notifications.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
// Only macOS can read the permission; elsewhere every answer is `Unknown`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum Access {
    Allowed,
    /// Allowed, but delivered to Notification Center without a banner.
    Quiet,
    /// Turned off for Concors in the system settings.
    Blocked,
    /// The system has not asked yet; the first request shows its prompt.
    NotAsked,
    /// Linux, Windows and `tauri dev` cannot tell, so delivery is attempted.
    Unknown,
}

#[tauri::command]
pub async fn notification_access() -> Result<Access, String> {
    blocking(platform::access).await
}

#[tauri::command]
pub async fn request_notification_access() -> Result<Access, String> {
    blocking(platform::request).await?
}

#[tauri::command]
pub fn open_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    platform::open_settings(&app.config().identifier)
}

#[tauri::command]
pub fn dismiss_agent_notification(token: String, state: tauri::State<'_, Notifications>) {
    if let Ok(mut tickets) = state.tickets.lock() {
        if let Some(active) = tickets.remove(&token) {
            active.store(false, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub async fn show_agent_notification(
    app: tauri::AppHandle,
    state: tauri::State<'_, Notifications>,
    token: String,
    title: String,
    body: String,
) -> Result<(), String> {
    if token.len() != 36 || title.len() > 200 || body.len() > 1000 {
        return Err("Invalid notification".into());
    }
    // Notifications are on by default, so the first one is what brings up the system prompt.
    let access = match blocking(platform::access).await? {
        Access::NotAsked => blocking(platform::request).await??,
        access => access,
    };
    match access {
        Access::Blocked => Err(BLOCKED.into()),
        Access::NotAsked => Err("macOS did not answer the notification permission request".into()),
        Access::Allowed | Access::Quiet | Access::Unknown => {
            deliver(app, &state, token, title, body)
        }
    }
}

fn deliver(
    app: tauri::AppHandle,
    state: &Notifications,
    token: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let mut tickets = state
        .tickets
        .lock()
        .map_err(|_| "Notification state unavailable")?;
    if tickets.contains_key(&token) {
        return Ok(());
    }
    if state.workers.load(Ordering::SeqCst) >= 32 {
        return Err("Too many pending native notifications".into());
    }
    let active = Arc::new(AtomicBool::new(true));
    tickets.insert(token.clone(), active.clone());
    let workers = state.workers.clone();
    workers.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut notification = notify_rust::Notification::new();
        // Escape body markup for freedesktop notification servers.
        #[cfg(target_os = "linux")]
        let body = body
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        notification
            .summary(&title)
            .body(&body)
            .appname("Concors")
            .action("default", "Open conversation")
            .timeout(8000);
        #[cfg(target_os = "linux")]
        notification.hint(notify_rust::Hint::SuppressSound(true));
        #[cfg(target_os = "macos")]
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            "dev.concors.desktop"
        });
        #[cfg(target_os = "windows")]
        if !tauri::is_dev() {
            notification.app_id("dev.concors.desktop");
        }
        let shown = notification.show().and_then(|handle| {
            handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                let clicked = matches!(response, notify_rust::NotificationResponse::Default)
                    || matches!(response, notify_rust::NotificationResponse::Action(action) if action == "default");
                if clicked && active.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit("agent-notification-click", &token);
                }
            })
        });
        if let Err(error) = shown {
            log::warn!("Native notification failed: {error}");
        }
        if let Ok(mut tickets) = app.state::<Notifications>().tickets.lock() {
            tickets.remove(&token);
        }
        workers.fetch_sub(1, Ordering::SeqCst);
    });
    Ok(())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Access;
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::Bool};
    use objc2_foundation::{NSBundle, NSError};
    use objc2_user_notifications::{
        UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings,
        UNUserNotificationCenter,
    };
    use std::{ptr::NonNull, sync::mpsc, time::Duration};

    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        // currentNotificationCenter raises outside an .app bundle, which is how `tauri dev` runs.
        if tauri::is_dev()
            || !NSBundle::mainBundle()
                .bundlePath()
                .to_string()
                .ends_with(".app")
        {
            return None;
        }
        Some(UNUserNotificationCenter::currentNotificationCenter())
    }

    pub fn access() -> Access {
        let Some(center) = center() else {
            return Access::Unknown;
        };
        let (sender, receiver) = mpsc::channel();
        let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: the system passes a valid settings object for the duration of the call.
            let settings = unsafe { settings.as_ref() };
            let _ = sender.send(classify(
                settings.authorizationStatus(),
                settings.alertStyle(),
            ));
        });
        center.getNotificationSettingsWithCompletionHandler(&handler);
        receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or(Access::Unknown)
    }

    pub fn request() -> Result<Access, String> {
        let Some(center) = center() else {
            return Ok(Access::Unknown);
        };
        let (sender, receiver) = mpsc::channel();
        let handler = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            // SAFETY: the error is either null or valid for the duration of the call.
            let error =
                unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string());
            let _ = sender.send(error);
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert,
            &handler,
        );
        // The prompt waits for the person, so this allows far longer than reading the settings.
        match receiver.recv_timeout(Duration::from_secs(600)) {
            Ok(Some(error)) => Err(format!(
                "macOS could not ask to allow notifications: {error}"
            )),
            _ => Ok(access()),
        }
    }

    pub fn open_settings(identifier: &str) -> Result<(), String> {
        let url = format!(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={identifier}"
        );
        let status = std::process::Command::new("open")
            .arg(url)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not open System Settings".into())
        }
    }

    fn classify(status: UNAuthorizationStatus, style: UNAlertStyle) -> Access {
        match status {
            UNAuthorizationStatus::NotDetermined => Access::NotAsked,
            UNAuthorizationStatus::Denied => Access::Blocked,
            UNAuthorizationStatus::Provisional => Access::Quiet,
            _ if style == UNAlertStyle::None => Access::Quiet,
            _ => Access::Allowed,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn classifies_system_settings() {
            use UNAlertStyle as Style;
            use UNAuthorizationStatus as Status;
            assert_eq!(
                classify(Status::NotDetermined, Style::None),
                Access::NotAsked
            );
            assert_eq!(classify(Status::Denied, Style::Banner), Access::Blocked);
            assert_eq!(classify(Status::Authorized, Style::Banner), Access::Allowed);
            assert_eq!(classify(Status::Authorized, Style::Alert), Access::Allowed);
            // "Allow notifications" on with the banner style set to None never shows anything.
            assert_eq!(classify(Status::Authorized, Style::None), Access::Quiet);
            assert_eq!(classify(Status::Provisional, Style::Banner), Access::Quiet);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::Access;

    pub fn access() -> Access {
        Access::Unknown
    }

    pub fn request() -> Result<Access, String> {
        Ok(Access::Unknown)
    }

    pub fn open_settings(_identifier: &str) -> Result<(), String> {
        Err("Open your system’s notification settings to allow Concors.".into())
    }
}
