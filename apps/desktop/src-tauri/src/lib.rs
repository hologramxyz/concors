//! Native shell of the Concors desktop app.
//!
//! This crate is deliberately thin. It owns only what genuinely needs to be native:
//!
//! - application lifecycle and window integration, including microphone access for dictation
//! - starting/stopping the bundled `concors-daemon` process
//! - (later) notifications, auto-updates, secure local storage
//!
//! Everything else — including all communication with the daemon — happens in the web frontend
//! over the Concors protocol. No product or agent-orchestration logic belongs here.

mod daemon;
mod downloads;
mod microphone;
mod notifications;
mod sign_in;
mod sound;
mod ssh_key;
mod update;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        // Opens links (Stripe Checkout, invoices) in the system browser instead of the webview.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(daemon::LocalDaemon::default())
        .manage(notifications::Notifications::default())
        .manage(sign_in::SignInListener::default())
        .setup(|app| {
            for window in app.webview_windows().values() {
                microphone::allow(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notifications::show_agent_notification,
            notifications::dismiss_agent_notification,
            sound::play_agent_sound,
            daemon::local_daemon_status,
            daemon::start_local_daemon,
            daemon::stop_local_daemon,
            sign_in::start_sign_in_listener,
            sign_in::cancel_sign_in_listener,
            ssh_key::device_ssh_key,
            update::app_installation,
            update::install_app_update,
            downloads::save_download,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Concors")
        .run(|app, event| {
            // Close our gateway; the detached host preserves terminal sessions for the next launch.
            if let tauri::RunEvent::Exit = event {
                app.state::<daemon::LocalDaemon>().shutdown();
            }
        });
}
