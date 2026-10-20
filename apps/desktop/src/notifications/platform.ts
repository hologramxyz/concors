import {
  isTauri,
  showNativeNotification,
  dismissNativeNotification,
  onNativeNotificationClick,
  nativeNotificationAccess,
  requestNativeNotificationAccess,
  openNativeNotificationSettings,
} from "@/tauri";
import type { NotificationAccess } from "./access";
import type { Notice } from "./engine";
const clicks = new Map<string, () => void>();
let listening: Promise<() => void> | null = null;
function browserAccess(): NotificationAccess {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "allowed";
  return Notification.permission === "denied" ? "blocked" : "not_asked";
}
export async function notificationAccess(): Promise<NotificationAccess> {
  return isTauri() ? nativeNotificationAccess() : browserAccess();
}
/** Shows the system or browser prompt when it has not been answered yet. */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  if (isTauri()) return requestNativeNotificationAccess();
  if (typeof Notification !== "undefined") await Notification.requestPermission();
  return browserAccess();
}
export async function openNotificationSettings(): Promise<void> {
  await openNativeNotificationSettings();
}
export async function desktopNotice(
  notice: Pick<Notice, "id" | "title" | "body">,
  onClick: () => void,
): Promise<() => void> {
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
  const access = browserAccess();
  if (access === "blocked")
    throw new Error(
      "Your browser is blocking notifications from Concors. Allow them in this site’s settings, then reload.",
    );
  if (access !== "allowed")
    throw new Error("Turn on Desktop notifications in Settings → Notifications to allow them.");
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
