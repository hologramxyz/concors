import { afterEach, expect, it, vi } from "vitest";
import { deviceStorage, machineCredentials, tokenStore } from "./storage.web";

afterEach(() => vi.unstubAllGlobals());
it("persists only noncredential preferences and reads them after module reload", async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      saved.delete(key);
    }),
  };
  vi.stubGlobal("localStorage", storage);
  const preferences = JSON.stringify({ shortcuts: { search: [] } });
  await deviceStorage.set("appearance.v1", preferences);
  const connection = machineCredentials.begin("user:org", "machine");
  await connection.save("private-machine-token");
  await tokenStore.hydrate();
  tokenStore.set("private-account-token");
  await tokenStore.flush();
  expect([...saved.entries()]).toEqual([["concors.mobile.appearance.v1", preferences]]);
  vi.resetModules();
  const reloaded = await import("./storage.web");
  expect(await reloaded.deviceStorage.get("appearance.v1")).toBe(preferences);
  expect(await reloaded.deviceStorage.get("machine-token.v1")).toBeNull();
  await reloaded.deviceStorage.set("appearance.v1", null);
  expect(saved.size).toBe(0);
});
it("reports preference write failures without replacing the current session value", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Unavailable");
    },
    setItem: () => {
      throw new Error("Storage full");
    },
  });
  await expect(deviceStorage.set("appearance.v1", "new-value")).rejects.toThrow("Storage full");
  expect(await deviceStorage.get("appearance.v1")).not.toBe("new-value");
});
