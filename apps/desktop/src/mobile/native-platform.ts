export { openExternal } from "./external";
// The mobile bundle never imports Tauri. Expo owns operating-system notifications.
export function isTauri() {
  return false;
}
export async function showNativeNotification() {
  throw new Error("Use native mobile push settings");
}
export async function dismissNativeNotification() {
  /* Expo owns delivered notifications. */
}
export async function onNativeNotificationClick() {
  return () => undefined;
}

export { readText as readClipboardText, copyText as writeClipboardText } from "@/lib/clipboard";
