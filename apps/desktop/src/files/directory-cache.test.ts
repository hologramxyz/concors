import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type { FileResult } from "@concors/protocol";
import { DirectoryCache, type DirectoryScope } from "./directory-cache";

const scope: DirectoryScope = {
  machineId: crypto.randomUUID(),
  epoch: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  directory: "/repo",
};
function result(name = "main.ts", truncated = false): FileResult {
  return {
    type: "file.result",
    requestId: crypto.randomUUID(),
    outcome: {
      status: "listed",
      entries: [{ name, path: `src/${name}`, kind: "file" }],
      truncated,
    },
  };
}
function setup() {
  const connection = { requestFile: vi.fn<DaemonConnection["requestFile"]>() };
  connection.requestFile.mockResolvedValue(result());
  return { connection, cache: new DirectoryCache(connection) };
}
function deferredResult() {
  let resolve!: (result: FileResult) => void;
  const promise = new Promise<FileResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());

it("reuses recent listings and deduplicates requests even when a folder is collapsed mid-load", async () => {
  const { cache, connection } = setup();
  const reply = deferredResult();
  connection.requestFile.mockReturnValueOnce(reply.promise);
  expect(cache.peek(scope, "src")).toBeUndefined();
  const first = cache.load(scope, "src");
  expect(cache.load(scope, "src")).toBe(first);
  reply.resolve(result("main.ts", true));
  const listing = await first;
  expect(cache.peek(scope, "src")).toBe(listing);
  expect(await cache.load(scope, "src")).toBe(listing);
  expect(listing.truncated).toBe(true);
  expect(connection.requestFile).toHaveBeenCalledTimes(1);
  expect(connection.requestFile).toHaveBeenCalledWith(
    {
      kind: "list",
      projectId: scope.projectId,
      epoch: scope.epoch,
      directory: "/repo",
      path: "src",
    },
    expect.any(String),
  );
});

it("keeps expired rows available while revalidating after 30 seconds", async () => {
  const { cache, connection } = setup();
  const previous = await cache.load(scope, "src");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
  const reply = deferredResult();
  connection.requestFile.mockReturnValueOnce(reply.promise);
  const loading = cache.load(scope, "src");
  expect(cache.peek(scope, "src")).toBe(previous);
  reply.resolve(result("updated.ts"));
  await loading;
  expect(cache.peek(scope, "src")?.entries[0]?.name).toBe("updated.ts");
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
});

it.each([
  { machineId: crypto.randomUUID() },
  { epoch: crypto.randomUUID() },
  { projectId: crypto.randomUUID() },
  { directory: "/different-root" },
])("isolates directory listings when the scope changes: %j", async (change) => {
  const { cache, connection } = setup();
  await cache.load(scope, "src");
  const other = { ...scope, ...change };
  expect(cache.peek(other, "src")).toBeUndefined();
  await cache.load(other, "src");
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
  expect(new DirectoryCache(connection).peek(scope, "src")).toBeUndefined();
});

it("invalidates all project folders, including collapsed ones, without dropping their rows", async () => {
  const { cache, connection } = setup();
  const other = { ...scope, projectId: crypto.randomUUID() };
  const first = await cache.load(scope, "src");
  await cache.load(scope, "docs");
  await cache.load(other, "src");
  cache.invalidate(scope);
  expect(cache.peek(scope, "src")).toBe(first);
  await cache.load(other, "src");
  expect(connection.requestFile).toHaveBeenCalledTimes(3);
  await cache.load(scope, "src");
  await cache.load(scope, "docs");
  expect(connection.requestFile).toHaveBeenCalledTimes(5);
});

it.each(["refresh", "reconnect"])("ignores obsolete replies after %s", async (reason) => {
  const { cache, connection } = setup();
  const reply = deferredResult();
  connection.requestFile.mockReturnValueOnce(reply.promise);
  const old = cache.load(scope, "src");
  // Let the request start before invalidating its generation.
  await Promise.resolve();
  cache.invalidate(reason === "refresh" ? scope : undefined);
  connection.requestFile.mockResolvedValueOnce(result("new.ts"));
  await cache.load(scope, "src");
  reply.resolve(result("old.ts"));
  await old;
  expect(cache.peek(scope, "src")?.entries[0]?.name).toBe("new.ts");
  expect(await cache.load(scope, "src")).toBe(cache.peek(scope, "src"));
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
});

it("revalidates every cached project after reconnect", async () => {
  const { cache, connection } = setup();
  const other = { ...scope, projectId: crypto.randomUUID() };
  await cache.load(scope, "src");
  await cache.load(other, "src");
  cache.invalidate();
  await cache.load(scope, "src");
  await cache.load(other, "src");
  expect(connection.requestFile).toHaveBeenCalledTimes(4);
});

it("retains the last good listing after a failed refresh and allows retry", async () => {
  const { cache, connection } = setup();
  const previous = await cache.load(scope, "src");
  cache.invalidate(scope);
  connection.requestFile.mockResolvedValueOnce({
    ...result(),
    outcome: { status: "error", message: "Permission denied" },
  });
  await expect(cache.load(scope, "src")).rejects.toThrow("Permission denied");
  expect(cache.peek(scope, "src")).toBe(previous);
  connection.requestFile.mockRejectedValueOnce(new Error("Disconnected"));
  await expect(cache.load(scope, "src")).rejects.toThrow("Disconnected");
  await expect(cache.load(scope, "src")).resolves.toEqual(previous);
  expect(connection.requestFile).toHaveBeenCalledTimes(4);
});

it("keeps at most 64 recently used folders and can reload an evicted folder", async () => {
  const { cache, connection } = setup();
  for (let i = 0; i < 64; i++) await cache.load(scope, `folder-${i}`);
  await cache.load(scope, "folder-0");
  await cache.load(scope, "folder-64");
  expect(cache.peek(scope, "folder-0")).toBeDefined();
  expect(cache.peek(scope, "folder-1")).toBeUndefined();
  expect(cache.peek(scope, "folder-64")).toBeDefined();
  await cache.load(scope, "folder-1");
  expect(connection.requestFile).toHaveBeenCalledTimes(66);
});

it("does not mistake a failed first load for an empty folder, and caches confirmed empty listings", async () => {
  const { cache, connection } = setup();
  connection.requestFile.mockRejectedValueOnce(new Error("Disconnected"));
  await expect(cache.load(scope, "empty")).rejects.toThrow("Disconnected");
  expect(cache.peek(scope, "empty")).toBeUndefined();
  connection.requestFile.mockResolvedValueOnce({
    ...result(),
    outcome: { status: "listed", entries: [], truncated: false },
  });
  await cache.load(scope, "empty");
  expect((await cache.load(scope, "empty")).entries).toEqual([]);
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
});
