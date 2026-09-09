import { describe, expect, it, vi } from "vitest";
import { HydratedTokenStore } from "./token-store.ts";

describe("secure session hydration", () => {
  it("does not authenticate before the secure store has been read", async () => {
    const read = vi.fn(async () => "saved");
    const store = new HydratedTokenStore({ read, write: async () => undefined });
    expect(() => store.get()).toThrow("still loading");
    await Promise.all([store.hydrate(), store.hydrate()]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe("saved");
  });
  it("serializes token rotation and deletion so delayed writes cannot restore a signed-out token", async () => {
    const writes: (string | null)[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new HydratedTokenStore({
      read: async () => null,
      write: async (token) => {
        if (token === "login") await gate;
        writes.push(token);
      },
    });
    await store.hydrate();
    store.set("login");
    store.set("rotated");
    store.set(null);
    expect(store.get()).toBeNull();
    release();
    await store.flush();
    expect(writes).toEqual(["login", "rotated", null]);
  });
  it("reports persistence failure and allows a later deletion to recover", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("keychain locked"))
      .mockResolvedValue(undefined);
    const store = new HydratedTokenStore({ read: async () => null, write });
    await store.hydrate();
    store.set("token");
    await expect(store.flush()).rejects.toThrow("securely");
    store.set(null);
    await expect(store.flush()).resolves.toBeUndefined();
  });
  it("retries a failed keychain read without silently dropping credentials", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce("saved");
    const store = new HydratedTokenStore({ read, write: vi.fn() });
    await expect(store.hydrate()).rejects.toThrow("locked");
    await store.hydrate();
    expect(store.get()).toBe("saved");
  });
});
