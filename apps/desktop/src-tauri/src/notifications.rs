//! Native delivery and click callbacks. Agent state and policy stay in TypeScript/the daemon.
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Notifications {
    tickets: Mutex<HashMap<String, Arc<AtomicBool>>>,
    workers: Arc<AtomicUsize>,
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
pub fn show_agent_notification(
    app: tauri::AppHandle,
    state: tauri::State<'_, Notifications>,
    token: String,
    title: String,
    body: String,
) -> Result<(), String> {
    if token.len() != 36 || title.len() > 200 || body.len() > 1000 {
        return Err("Invalid notification".into());
    }
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
        match notification.show() {
            Ok(handle) => {
                let _ = handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
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
                });
            }
            Err(error) => log::warn!("Native notification failed: {error}"),
        }
        if let Ok(mut tickets) = app.state::<Notifications>().tickets.lock() {
            tickets.remove(&token);
        }
        workers.fetch_sub(1, Ordering::SeqCst);
    });
    Ok(())
}
