import { HydratedTokenStore } from "@concors/client-core";
import { expect, it, vi } from "vitest";
import { apiSessionStorage } from "./session-storage";

const api = "https://api.concors.dev";

it("restores a scoped session and does not forward it after switching backend", async () => {
  let saved: string | null = null;
  const storage = {
    read: async () => saved,
    write: async (value: string | null) => {
      saved = value;
    },
  };
  const first = new HydratedTokenStore(apiSessionStorage("https://old-dev.example.com", storage));
  await first.hydrate();
  first.set("fixture-dev-session");
  await first.flush();
  const switched = new HydratedTokenStore(apiSessionStorage(api, storage));
  await switched.hydrate();
  expect(switched.get()).toBeNull();
  switched.set("fixture-production-session");
  await switched.flush();
  const restored = new HydratedTokenStore(apiSessionStorage(`${api}/`, storage));
  await restored.hydrate();
  expect(restored.get()).toBe("fixture-production-session");
  restored.set(null);
  await restored.flush();
  expect(saved).toBeNull();
});

it.each([
  "legacy-opaque-token",
  "null",
  "{}",
  JSON.stringify({ token: "unscoped" }),
  JSON.stringify({ apiUrl: api, token: "" }),
  JSON.stringify({ apiUrl: api, token: 123 }),
  JSON.stringify({ apiUrl: "https://api.concors.dev/other", token: "other-path" }),
  JSON.stringify({ apiUrl: "https://api.concors.dev:444", token: "other-port" }),
])("ignores invalid or foreign saved sessions: %s", async (value) => {
  const storage = { read: async () => value, write: vi.fn() };
  expect(await apiSessionStorage(api, storage).read()).toBeNull();
  expect(storage.write).not.toHaveBeenCalled();
});

it("propagates secure-storage errors instead of silently discarding them", async () => {
  const failure = new Error("Keychain locked");
  const storage = {
    read: vi.fn().mockRejectedValue(failure),
    write: vi.fn().mockRejectedValue(failure),
  };
  const scoped = apiSessionStorage(api, storage);
  await expect(scoped.read()).rejects.toBe(failure);
  await expect(scoped.write("fixture")).rejects.toBe(failure);
});
