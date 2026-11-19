import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export async function showNativeNotification(
  token: string,
  title: string,
  body: string,
): Promise<void> {
  await invoke("show_agent_notification", {
    token,
    title: title.slice(0, 120),
    body: body.slice(0, 240),
  });
}
/**
 * Plays a built-in sound by name, or a picked file's bytes, through the system's player. The
 * bytes go as the raw request body, since a JSON array of a megabyte of numbers is slow to send.
 */
export async function playNativeSound(
  sound: string | { extension: string; bytes: ArrayBuffer },
  volume: number,
): Promise<void> {
  if (typeof sound === "string") await invoke("play_agent_sound", { sound, volume });
  else
    await invoke("play_custom_sound", new Uint8Array(sound.bytes), {
      headers: { "x-sound-extension": sound.extension, "x-sound-volume": String(volume) },
    });
}
export async function dismissNativeNotification(token: string): Promise<void> {
  await invoke("dismiss_agent_notification", { token });
}
export async function onNativeNotificationClick(
  listener: (token: string) => void,
): Promise<() => void> {
  return listen<string>("agent-notification-click", (event) => listener(event.payload));
}
/** What the operating system lets Concors show; see `Access` in `notifications.rs`. */
export type NativeNotificationAccess = "allowed" | "quiet" | "blocked" | "not_asked" | "unknown";
export async function nativeNotificationAccess(): Promise<NativeNotificationAccess> {
  return invoke("notification_access");
}
export async function requestNativeNotificationAccess(): Promise<NativeNotificationAccess> {
  return invoke("request_notification_access");
}
export async function openNativeNotificationSettings(): Promise<void> {
  await invoke("open_notification_settings");
}
