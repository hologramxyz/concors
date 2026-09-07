import {
  isTauri,
  showNativeNotification,
  dismissNativeNotification,
  onNativeNotificationClick,
} from "@/tauri";
import type { Notice } from "./engine";
const clicks = new Map<string, () => void>();
let listening: Promise<() => void> | null = null;
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (isTauri()) return "granted";
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
export async function requestNotificationPermission(): Promise<boolean> {
  if (isTauri()) return true;
  return (
    typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted"
  );
}
export async function desktopNotice(notice: Notice, onClick: () => void): Promise<() => void> {
  if (isTauri()) {
    listening ??= onNativeNotificationClick((token) => clicks.get(token)?.());
    await listening;
    clicks.set(notice.id, onClick);
    try {
      await showNativeNotification(notice.id, notice.title, notice.body);
    } catch (error) {
      clicks.delete(notice.id);
      throw error;
    }
    return () => {
      clicks.delete(notice.id);
      void dismissNativeNotification(notice.id).catch(() => undefined);
    };
  }
  if (notificationPermission() !== "granted") return () => undefined;
  const notification = new Notification(notice.title, {
    body: notice.body,
    tag: notice.id,
    silent: true,
  });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
  return () => notification.close();
}
