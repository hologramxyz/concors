import { useSyncExternalStore } from "react";
import { isTauri } from "@/tauri";
export interface NotificationPreferences {
  sound: boolean;
  desktop: boolean;
}
export const PREFERENCES_KEY = "concors.notifications.v2";
const LEGACY_KEY = "concors.notifications.v1";
// Sound is on by default, as in Herdr. The desktop app turns banners on too, because it asks the
// system for permission itself and an off switch nobody found meant notifications never came.
// Browsers can only ask from a click, so there banners wait for an explicit opt-in.
const defaults = (): NotificationPreferences => ({ sound: true, desktop: isTauri() });
let current: NotificationPreferences = readNotificationPreferences();
const listeners = new Set<() => void>();
function parse(key: string): NotificationPreferences | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "sound" in value &&
      typeof value.sound === "boolean" &&
      "desktop" in value &&
      typeof value.desktop === "boolean"
    )
      return { sound: value.sound, desktop: value.desktop };
  } catch {
    /* Storage may be unavailable. */
  }
  return null;
}
export function readNotificationPreferences(): NotificationPreferences {
  const stored = parse(PREFERENCES_KEY);
  if (stored) return stored;
  // Version 1 saved the old default-off banners whenever sound was toggled, so its `false` was
  // almost never a choice; the desktop app moves those to the new default.
  const legacy = parse(LEGACY_KEY);
  if (legacy) return { ...legacy, desktop: legacy.desktop || defaults().desktop };
  return defaults();
}
function notify() {
  for (const listener of listeners) listener();
}
export function getNotificationPreferences() {
  return current;
}
export function setNotificationPreferences(value: NotificationPreferences) {
  current = value;
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
  } catch {
    /* Keep this window usable. */
  }
  notify();
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === PREFERENCES_KEY) {
      current = readNotificationPreferences();
      notify();
    }
  });
export function useNotificationPreferences() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getNotificationPreferences);
}

/** A browser-wide lock makes delivery once-per-device even with two windows open. */
export async function claimNotification(machineId: string, id: string): Promise<boolean> {
  const key = `concors.notification-receipts.v1.${machineId}`;
  const claim = () => {
    let seen: string[] = [];
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(value)) seen = value.filter((v): v is string => typeof v === "string");
    } catch {
      /* Use in-memory engine deduplication when storage is blocked. */
    }
    if (seen.includes(id)) return false;
    try {
      localStorage.setItem(key, JSON.stringify([...seen.slice(-1023), id]));
    } catch {
      /* The active connection still deduplicates. */
    }
    return true;
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(key, claim);
  return claim();
}
