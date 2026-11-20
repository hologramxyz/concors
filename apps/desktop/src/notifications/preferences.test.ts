import { beforeEach, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ value: true }));
vi.mock("@/tauri", () => ({ isTauri: () => tauri.value }));
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});
const { readNotificationPreferences } = await import("./preferences");
const sounds = { sounds: { done: "done", needs_input: "request" }, customNames: {}, volume: 1 };

beforeEach(() => {
  storage.clear();
  tauri.value = true;
});

it("turns desktop notifications on by default in the desktop app only", () => {
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: true, ...sounds });
  tauri.value = false;
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: false, ...sounds });
});

it("moves the old default-off setting to the new default, keeping the sound choice", () => {
  storage.set("concors.notifications.v1", JSON.stringify({ sound: false, desktop: false }));
  expect(readNotificationPreferences()).toEqual({ sound: false, desktop: true, ...sounds });
  tauri.value = false;
  expect(readNotificationPreferences()).toEqual({ sound: false, desktop: false, ...sounds });
});

it("respects a choice saved after the change", () => {
  storage.set("concors.notifications.v1", JSON.stringify({ sound: true, desktop: true }));
  storage.set("concors.notifications.v2", JSON.stringify({ sound: true, desktop: false }));
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: false, ...sounds });
});

it("keeps each event's sound and the volume, and repairs what it cannot read", () => {
  storage.set(
    "concors.notifications.v2",
    JSON.stringify({
      sound: true,
      desktop: false,
      sounds: { done: "custom", needs_input: "a-sound-from-a-newer-version" },
      customNames: { done: "gong.wav", needs_input: 3 },
      volume: 7,
    }),
  );
  expect(readNotificationPreferences()).toEqual({
    sound: true,
    desktop: false,
    sounds: { done: "custom", needs_input: "request" },
    customNames: { done: "gong.wav" },
    volume: 1,
  });
});

it("changes one preference without resetting the others", () => {
  storage.set(
    "concors.notifications.v2",
    JSON.stringify({ sound: true, desktop: true, sounds: { done: "bell" }, volume: 0.4 }),
  );
  vi.resetModules();
  return import("./preferences").then(
    ({ getNotificationPreferences, setNotificationPreferences }) => {
      setNotificationPreferences({ sound: false });
      expect(getNotificationPreferences()).toMatchObject({
        sound: false,
        sounds: { done: "bell", needs_input: "request" },
        volume: 0.4,
      });
      expect(JSON.parse(storage.get("concors.notifications.v2") ?? "{}")).toMatchObject({
        sounds: { done: "bell" },
      });
    },
  );
});
