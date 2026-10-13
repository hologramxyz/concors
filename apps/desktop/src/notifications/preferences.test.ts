import { beforeEach, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ value: true }));
vi.mock("@/tauri", () => ({ isTauri: () => tauri.value }));
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});
const { readNotificationPreferences } = await import("./preferences");

beforeEach(() => {
  storage.clear();
  tauri.value = true;
});

it("turns desktop notifications on by default in the desktop app only", () => {
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: true });
  tauri.value = false;
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: false });
});

it("moves the old default-off setting to the new default, keeping the sound choice", () => {
  storage.set("concors.notifications.v1", JSON.stringify({ sound: false, desktop: false }));
  expect(readNotificationPreferences()).toEqual({ sound: false, desktop: true });
  tauri.value = false;
  expect(readNotificationPreferences()).toEqual({ sound: false, desktop: false });
});

it("respects a choice saved after the change", () => {
  storage.set("concors.notifications.v1", JSON.stringify({ sound: true, desktop: true }));
  storage.set("concors.notifications.v2", JSON.stringify({ sound: true, desktop: false }));
  expect(readNotificationPreferences()).toEqual({ sound: true, desktop: false });
});
