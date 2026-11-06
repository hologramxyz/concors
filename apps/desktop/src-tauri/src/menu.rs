//! The Mac's menu bar: Tauri's default, except that ⌘W closes the active tab instead of the
//! window. Concors has one window, so closing it quit the whole app from a key people press to
//! close a tab. The window still closes from its red button, and ⌘Q still quits.
//!
//! Windows and Linux keep their defaults: there Ctrl+W deletes a word in a terminal, so it is not
//! taken over.

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Runtime};

const CLOSE_TAB: &str = "close-tab";
/// What the web app listens for; it closes the active tab exactly as its own shortcut does.
const CLOSE_TAB_EVENT: &str = "menu-close-tab";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let package = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let close_tab = MenuItem::with_id(app, CLOSE_TAB, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                package.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_tab])?,
            // The webview's text fields need these for copy, paste and undo to work at all.
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            // No Close Window here: its ⌘W would take the key back from Close Tab.
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?,
        ],
    )
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == CLOSE_TAB {
        if let Err(error) = app.emit(CLOSE_TAB_EVENT, ()) {
            log::warn!("Close Tab did not reach the window: {error}");
        }
    }
}
