import { expect, it, vi } from "vitest";
import { ProviderCatalogCache } from "./provider-catalog-cache";
import type { AgentProviderCatalog } from "@concors/protocol";

const row = (id = "claude", revision = "0:0"): AgentProviderCatalog => ({
  id,
  revision,
  loaded: true,
  models: [{ id: "sonnet", label: "Sonnet 5", efforts: [], defaultEffort: null }],
});
const deferred = () => {
  let resolve!: (rows: AgentProviderCatalog[]) => void;
  const promise = new Promise<AgentProviderCatalog[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it("deduplicates discovery and keeps models visible during refresh", async () => {
  const cache = new ProviderCatalogCache();
  const first = deferred(),
    request = vi.fn(() => first.promise);
  const a = cache.load("claude", request),
    b = cache.load("claude", request);
  expect(a).toBe(b);
  first.resolve([row()]);
  await a;
  expect(request).toHaveBeenCalledTimes(1);
  const refresh = deferred();
  const pending = cache.load("claude", () => refresh.promise);
  expect(cache.getSnapshot()).toEqual([row()]);
  refresh.resolve([{ ...row(), models: [{ ...row().models[0]!, label: "Sonnet 5.1" }] }]);
  await pending;
  expect(cache.getSnapshot()[0]?.models[0]?.label).toBe("Sonnet 5.1");
});
it("retains loaded models for lightweight rows and transient errors, but invalidates changed accounts/configs", async () => {
  const cache = new ProviderCatalogCache();
  await cache.load("claude", async () => [row()]);
  await cache.load("codex", async () => [{ ...row(), models: [], loaded: false }]);
  expect(cache.getSnapshot()[0]?.models).toHaveLength(1);
  await cache.load("claude", async () => [{ ...row(), models: [], error: "Offline" }]);
  expect(cache.getSnapshot()[0]).toMatchObject({ models: row().models, error: "Offline" });
  await cache.load("codex", async () => [{ ...row("claude", "1:0"), models: [], loaded: false }]);
  expect(cache.getSnapshot()[0]?.models).toEqual([]);
});
it("does not revive a cache with a late response after disconnect", async () => {
  const cache = new ProviderCatalogCache(),
    first = deferred();
  const pending = cache.load("claude", () => first.promise);
  cache.clear();
  first.resolve([row()]);
  await pending;
  expect(cache.getSnapshot()).toEqual([]);
});
it("does not overwrite another provider's fresh models with a late cached snapshot", async () => {
  const cache = new ProviderCatalogCache(),
    slow = deferred();
  await cache.load("claude", async () => [row()]);
  const pending = cache.load("codex", () => slow.promise);
  const fresh = { ...row(), models: [{ ...row().models[0]!, label: "Sonnet 5.1" }] };
  await cache.load("claude", async () => [fresh]);
  slow.resolve([row(), row("codex")]);
  await pending;
  expect(cache.getSnapshot().find((p) => p.id === "claude")).toEqual(fresh);
});
it("ignores a slow response from an older account/config revision", async () => {
  const cache = new ProviderCatalogCache(),
    slow = deferred();
  const pending = cache.load("claude", () => slow.promise);
  await cache.load("codex", async () => [row("codex", "2:1")]);
  slow.resolve([row("claude", "2:0")]);
  await pending;
  expect(cache.getSnapshot()).toEqual([row("codex", "2:1")]);
});
