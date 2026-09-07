//! Native shell of the Concors desktop app.
//!
//! This crate is deliberately thin. It owns only what genuinely needs to be native:
//!
//! - application lifecycle and window integration
//! - starting/stopping the bundled `concors-daemon` process
//! - (later) notifications, auto-updates, secure local storage
//!
//! Everything else — including all communication with the daemon — happens in the web frontend
//! over the Concors protocol. No product or agent-orchestration logic belongs here.

mod daemon;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .manage(daemon::LocalDaemon::default())
        .invoke_handler(tauri::generate_handler![
            daemon::local_daemon_status,
            daemon::start_local_daemon,
            daemon::stop_local_daemon,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Concors")
        .run(|app, event| {
            // Make sure a daemon we started never outlives the app.
            if let tauri::RunEvent::Exit = event {
                app.state::<daemon::LocalDaemon>().shutdown();
            }
        });
}
