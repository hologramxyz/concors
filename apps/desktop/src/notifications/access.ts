import type { NativeNotificationAccess } from "@/tauri";

/** Whether the system or browser shows Concors notifications, and what to do when it does not. */
export type NotificationAccess = NativeNotificationAccess | "unsupported";

export interface AccessHint {
  readonly text: string;
  readonly tone: "ok" | "warning";
  /** `request` asks for permission in place; `settings` opens the system's notification settings. */
  readonly action?: "request" | "settings";
}

/**
 * Plain instructions for each permission state. Only the macOS app can read the native state;
 * Linux and Windows report `unknown`, which says nothing rather than guess.
 */
export function accessHint(access: NotificationAccess, native: boolean): AccessHint | null {
  switch (access) {
    case "allowed":
      return {
        tone: "ok",
        text: native
          ? "macOS is allowing Concors to show notifications."
          : "Your browser is allowing notifications from Concors.",
      };
    case "quiet":
      return {
        tone: "warning",
        action: "settings",
        text: "macOS delivers Concors notifications without a banner. In System Settings → Notifications → Concors, set the alert style to Banners or Alerts.",
      };
    case "blocked":
      return native
        ? {
            tone: "warning",
            action: "settings",
            text: "Notifications for Concors are turned off in macOS. Turn on Allow notifications in System Settings → Notifications → Concors.",
          }
        : {
            tone: "warning",
            text: "Your browser is blocking notifications from Concors. Allow them in this site’s settings (next to the address bar), then reload.",
          };
    case "not_asked":
      return {
        tone: "warning",
        action: "request",
        text: native
          ? "macOS hasn’t been asked yet. Allow notifications so banners can appear."
          : "Your browser hasn’t been asked yet. Allow notifications so banners can appear.",
      };
    case "unsupported":
      return { tone: "warning", text: "Desktop notifications aren’t supported by this browser." };
    case "unknown":
      return null;
  }
}

/** Tauri rejects with the command's error string, not an `Error`, so read both. */
export function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return fallback;
}

/**
 * What to say when a notification could not be shown. macOS's own wording ("UNErrorDomain error 1")
 * tells nobody what to do, and refusing permission is all it usually means. Other failures keep
 * their detail, since a browser's already says what to change.
 */
export function notificationProblem(
  detail: string,
  access: NotificationAccess | "unknown",
  native: boolean,
): { message: string; settings: boolean } {
  return native && (access === "blocked" || access === "quiet" || /allow/i.test(detail))
    ? { message: "Notifications are off for Concors", settings: true }
    : { message: `A desktop notification could not be shown: ${detail}`, settings: false };
}

let problemReported = false;
/** True the first time it is asked: one popup a session says it, not one per notification. */
export function firstNotificationProblem(): boolean {
  const first = !problemReported;
  problemReported = true;
  return first;
}
