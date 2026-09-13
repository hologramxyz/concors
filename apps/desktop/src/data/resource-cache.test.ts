import { afterEach, expect, it, vi } from "vitest";
import { Resource, ResourceCache } from "./resource-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

it("coalesces simultaneous consumers and reuses a fresh response on reopening", async () => {
  const answer = deferred<string[]>();
  const request = vi.fn(() => answer.promise);
  const cache = new ResourceCache();
  const first = cache.resource("machines:alice", request);
  const second = cache.resource("machines:alice", request);
  expect(first).toBe(second);
  const a = first.load();
  const b = second.load();
  expect(a).toBe(b);
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  expect(first.getSnapshot()).toMatchObject({ data: null, pending: true });
  answer.resolve(["VPS"]);
  await a;
  await second.load();
  expect(request).toHaveBeenCalledTimes(1);
  expect(second.getSnapshot()).toMatchObject({ data: ["VPS"], pending: false });
});

it("retains rows while stale data refreshes and on temporary failures; retry recovers", async () => {
  vi.useFakeTimers();
  const refresh = deferred<string[]>();
  const request = vi
    .fn<() => Promise<string[]>>()
    .mockResolvedValueOnce(["old"])
    .mockImplementationOnce(() => refresh.promise)
    .mockResolvedValueOnce(["new"]);
  const resource = new Resource(request);
  await resource.load();
  vi.advanceTimersByTime(30_001);
  const job = resource.load();
  expect(resource.getSnapshot()).toMatchObject({ data: ["old"], pending: true });
  refresh.reject(new Error("offline"));
  await job;
  expect(resource.getSnapshot()).toMatchObject({
    data: ["old"],
    pending: false,
    error: expect.any(Error),
  });
  await resource.load();
  expect(resource.getSnapshot()).toMatchObject({ data: ["new"], error: null });
});

it("a slow list cannot overwrite a successful mutation", async () => {
  const answer = deferred<string[]>();
  const resource = new Resource(() => answer.promise);
  const job = resource.load();
  resource.set(["renamed VPS"]);
  answer.resolve(["old name"]);
  await job;
  expect(resource.getSnapshot().data).toEqual(["renamed VPS"]);
});

it("invalidation supersedes pending requests, preserving current rows until replacement", async () => {
  const answer = deferred<string[]>();
  const request = vi
    .fn<() => Promise<string[]>>()
    .mockImplementationOnce(() => answer.promise)
    .mockResolvedValueOnce(["new"]);
  const resource = new Resource(request);
  resource.set(["current"]);
  const job = resource.load(0, true);
  await Promise.resolve();
  resource.invalidate();
  expect(resource.getSnapshot().data).toEqual(["current"]);
  await resource.load();
  answer.resolve(["stale"]);
  await job;
  expect(resource.getSnapshot().data).toEqual(["new"]);
});

it("isolates organizations, and clearing a session cannot be undone by old responses", async () => {
  const cache = new ResourceCache();
  const answer = deferred<string[]>();
  const alice = cache.resource("machines:alice", () => answer.promise);
  const bob = cache.resource("machines:bob", async () => ["bob"]);
  const job = alice.load();
  await bob.load();
  expect(alice.getSnapshot().data).toBeNull();
  expect(bob.getSnapshot().data).toEqual(["bob"]);
  cache.clear();
  answer.resolve(["alice"]);
  await job;
  expect(alice.getSnapshot().data).toBeNull();
  expect(bob.getSnapshot().data).toBeNull();
  expect(cache.resource("machines:bob", async () => ["new session"])).not.toBe(bob);
});

it("removes cached data when access is rejected", async () => {
  const resource = new Resource<string[]>(
    async () => {
      throw new Error("revoked");
    },
    () => true,
  );
  resource.set(["private repo"]);
  await resource.load(0, true);
  expect(resource.getSnapshot()).toMatchObject({
    data: null,
    pending: false,
    error: expect.any(Error),
  });
});

it("explicit refresh bypasses freshness and invalidation only affects its resource family", async () => {
  const request = vi.fn(async () => ["repo"]);
  const cache = new ResourceCache();
  const repos = cache.resource("github:repos:1", request);
  const machines = cache.resource("machines:one", async () => ["VPS"]);
  await repos.load();
  await machines.load();
  await repos.load(30_000, true);
  expect(request).toHaveBeenCalledTimes(2);
  cache.invalidate("github:", true);
  expect(repos.getSnapshot().data).toBeNull();
  expect(machines.getSnapshot().data).toEqual(["VPS"]);
});
