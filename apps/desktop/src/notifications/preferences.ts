import { useSyncExternalStore } from "react";
export interface NotificationPreferences {
  sound: boolean;
  desktop: boolean;
}
export const PREFERENCES_KEY = "concors.notifications.v1";
// Sound is on by default, as in Herdr; desktop banners need an explicit browser permission.
const defaults: NotificationPreferences = { sound: true, desktop: false };
let current: NotificationPreferences = read();
const listeners = new Set<() => void>();
function read(): NotificationPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
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
  return defaults;
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
      current = read();
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
