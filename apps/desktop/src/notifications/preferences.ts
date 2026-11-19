import { useSyncExternalStore } from "react";
import { isTauri } from "@/tauri";
/** What an agent can want attention for, each with its own sound. */
export type SoundEvent = "done" | "needs_input";
/** The sounds that ship with the app, in the order the pickers list them. */
export const BUILT_IN_SOUNDS = [
  { id: "done", label: "Classic" },
  { id: "request", label: "Request" },
  { id: "chime", label: "Chime" },
  { id: "ping", label: "Ping" },
  { id: "pop", label: "Pop" },
  { id: "bell", label: "Bell" },
  { id: "rise", label: "Rise" },
  { id: "knock", label: "Knock" },
] as const;
export type BuiltInSound = (typeof BUILT_IN_SOUNDS)[number]["id"];
/** A built-in sound, the person's own file (kept in IndexedDB, see custom-sounds.ts), or silence. */
export type SoundChoice = BuiltInSound | "custom" | "none";
export interface NotificationPreferences {
  /** The switch for every agent sound; each event's choice below applies while it is on. */
  sound: boolean;
  desktop: boolean;
  sounds: Record<SoundEvent, SoundChoice>;
  /** The name of the file picked for an event, shown in its picker. */
  customNames: Partial<Record<SoundEvent, string>>;
  /** 0 to 1, applied on top of the system volume. */
  volume: number;
}
export const PREFERENCES_KEY = "concors.notifications.v2";
const LEGACY_KEY = "concors.notifications.v1";
// Sound is on by default, as in Herdr. The desktop app turns banners on too, because it asks the
// system for permission itself and an off switch nobody found meant notifications never came.
// Browsers can only ask from a click, so there banners wait for an explicit opt-in.
export const DEFAULT_SOUNDS: Record<SoundEvent, BuiltInSound> = {
  done: "done",
  needs_input: "request",
};
const defaults = (): NotificationPreferences => ({
  sound: true,
  desktop: isTauri(),
  sounds: DEFAULT_SOUNDS,
  customNames: {},
  volume: 1,
});
const CHOICES = new Set<string>([...BUILT_IN_SOUNDS.map((s) => s.id), "custom", "none"]);
const choice = (value: unknown, fallback: SoundChoice): SoundChoice =>
  typeof value === "string" && CHOICES.has(value) ? (value as SoundChoice) : fallback;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
    ) {
      // Sound choices and volume came later: settings saved before them keep the defaults.
      const sounds = record("sounds" in value ? value.sounds : null);
      const names = record("customNames" in value ? value.customNames : null);
      const volume = "volume" in value ? Number(value.volume) : 1;
      const name = (key: SoundEvent) =>
        typeof names[key] === "string" ? { [key]: names[key] } : {};
      return {
        sound: value.sound,
        desktop: value.desktop,
        sounds: {
          done: choice(sounds["done"], DEFAULT_SOUNDS.done),
          needs_input: choice(sounds["needs_input"], DEFAULT_SOUNDS.needs_input),
        },
        customNames: { ...name("done"), ...name("needs_input") },
        volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
      };
    }
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
/** Changes some preferences, keeping the rest as they are. */
export function setNotificationPreferences(change: Partial<NotificationPreferences>) {
  const value = { ...current, ...change };
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
