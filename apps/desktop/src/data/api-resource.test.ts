import { beforeEach, expect, it, vi } from "vitest";
import { getApiCacheScope } from "@/auth/api";
import { apiCache, clearApiCache } from "./api-resource";

vi.mock("@/auth/api", () => ({ getApiCacheScope: vi.fn(() => "session-one") }));
beforeEach(() => {
  clearApiCache();
  vi.mocked(getApiCacheScope).mockReturnValue("session-one");
});

it("reuses a cache within one scope and drops data when the host session changes", async () => {
  const first = apiCache();
  const resource = first.resource("account", async () => ({ name: "First account" }));
  await resource.load();
  expect(apiCache()).toBe(first);
  expect(resource.getSnapshot().data).toEqual({ name: "First account" });
  vi.mocked(getApiCacheScope).mockReturnValue("session-two");
  const next = apiCache();
  expect(next).not.toBe(first);
  expect(resource.getSnapshot().data).toBeNull();
  expect(
    next.resource("account", async () => ({ name: "Second account" })).getSnapshot().data,
  ).toBeNull();
});

it("does not accept a late response from a disposed account scope", async () => {
  let finish!: (value: string) => void;
  const resource = apiCache().resource(
    "account",
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const loading = resource.load();
  await Promise.resolve();
  vi.mocked(getApiCacheScope).mockReturnValue("session-two");
  apiCache();
  finish("Previous account");
  await loading;
  expect(resource.getSnapshot().data).toBeNull();
});
