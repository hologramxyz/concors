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
export async function dismissNativeNotification(token: string): Promise<void> {
  await invoke("dismiss_agent_notification", { token });
}
export async function onNativeNotificationClick(
  listener: (token: string) => void,
): Promise<() => void> {
  return listen<string>("agent-notification-click", (event) => listener(event.payload));
}
