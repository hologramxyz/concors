import { listen } from "@tauri-apps/api/event";

/**
 * The Mac menu's Close Tab (⌘W), which closes the active tab rather than the app's one window. See
 * `menu.rs`; elsewhere nothing sends it.
 */
export function onMenuCloseTab(listener: () => void): Promise<() => void> {
  return listen("menu-close-tab", () => listener());
}
