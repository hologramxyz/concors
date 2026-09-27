import { expect, it, vi } from "vitest";
import type { NativeSessionPage } from "@concors/protocol";
import { SessionCatalog } from "./session-catalog";

const providers = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
];
const session = (id: string, day = "12") => ({
  id,
  title: id,
  directory: "/repo",
  updatedAt: `2026-09-${day}T00:00:00Z`,
});
const page = (id: string, nextCursor: string | null = null): NativeSessionPage => ({
  sessions: [session(id)],
  nextCursor,
});
const settled = async (catalog: SessionCatalog) => {
  await vi.waitFor(() => {
    expect(catalog.getSnapshot().providers.every((provider) => !provider.loading)).toBe(true);
  });
};
const deferred = () => {
  let resolve!: (page: NativeSessionPage) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<NativeSessionPage>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

it("combines cached providers by recency without conflating identical native session IDs", () => {
  const read = vi.fn();
  const catalog = new SessionCatalog(providers, read, (provider) => ({
    page: {
      sessions: [session("same-id", provider === "claude" ? "13" : "12")],
      nextCursor: null,
    },
    stale: false,
  }));
  catalog.start();
  expect(catalog.getSnapshot().sessions.map((row) => [row.provider, row.id])).toEqual([
    ["claude", "same-id"],
    ["codex", "same-id"],
  ]);
  expect(catalog.getSnapshot().sessions[0]?.providerLabel).toBe("Claude Code");
  expect(read).not.toHaveBeenCalled();
  catalog.stop();
});

it("shows a stale list at once, replaces it quietly, and keeps it if the refresh fails", async () => {
  const fetched = deferred();
  const read = vi.fn((provider: string) =>
    provider === "codex" ? fetched.promise : Promise.reject(new Error("offline")),
  );
  const catalog = new SessionCatalog(providers, read, (provider) => ({
    page: { sessions: [session(`old-${provider}`)], nextCursor: "cursor" },
    stale: true,
  }));
  catalog.start();
  const snapshot = catalog.getSnapshot();
  expect(snapshot.sessions.map((row) => row.id).sort()).toEqual(["old-claude", "old-codex"]);
  // Refreshing is not loading: no spinner, and no second page while the first is replaced.
  expect(snapshot.providers.every((provider) => !provider.loading)).toBe(true);
  catalog.loadMore();
  expect(read.mock.calls).toEqual([
    ["codex", undefined],
    ["claude", undefined],
  ]);
  fetched.resolve(page("new-codex"));
  await vi.waitFor(() => {
    expect(
      catalog
        .getSnapshot()
        .sessions.map((row) => row.id)
        .sort(),
    ).toEqual(["new-codex", "old-claude"]);
  });
  expect(catalog.getSnapshot().providers.map((provider) => provider.error)).toEqual([null, null]);
  catalog.stop();
});

it("publishes successful providers even when another fails, and retries only the failure", async () => {
  let failed = true;
  const read = vi.fn(async (provider: string) => {
    if (provider === "claude" && failed) throw new Error("Provider unavailable");
    return page(provider);
  });
  const catalog = new SessionCatalog(providers, read, () => undefined);
  catalog.start();
  await settled(catalog);
  expect(catalog.getSnapshot().sessions.map((row) => row.provider)).toEqual(["codex"]);
  expect(catalog.getSnapshot().providers.find((p) => p.id === "claude")?.error).toBe(
    "Provider unavailable",
  );
  catalog.loadMore();
  expect(read).toHaveBeenCalledTimes(2);
  failed = false;
  catalog.retry("claude");
  await settled(catalog);
  expect(catalog.getSnapshot().sessions).toHaveLength(2);
  expect(catalog.getSnapshot().providers.every((p) => !p.error)).toBe(true);
  expect(read).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenLastCalledWith("claude", undefined);
  catalog.stop();
});

it("limits concurrent provider requests and drains the remaining providers", async () => {
  const installed = ["codex", "claude", "opencode", "pi", "omp"].map((id) => ({ id, label: id }));
  const pending = new Map<string, (page: NativeSessionPage) => void>();
  const read = vi.fn(
    (provider: string) =>
      new Promise<NativeSessionPage>((resolve) => pending.set(provider, resolve)),
  );
  const catalog = new SessionCatalog(installed, read, () => undefined);
  catalog.start();
  expect(read).toHaveBeenCalledTimes(3);
  expect(catalog.getSnapshot().providers.every((p) => p.loading)).toBe(true);
  pending.get("codex")?.(page("codex"));
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  pending.get("claude")?.(page("claude"));
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
  for (const id of ["opencode", "pi", "omp"]) pending.get(id)?.(page(id));
  await settled(catalog);
  expect(catalog.getSnapshot().sessions).toHaveLength(5);
  catalog.stop();
});

it("paginates a filtered provider independently and then loads the remaining all-provider pages", async () => {
  const read = vi.fn(async (provider: string, cursor?: string) => {
    expect(cursor).toBe("next");
    return page(`${provider}-older`);
  });
  const catalog = new SessionCatalog(providers, read, (provider) => ({
    page: page(provider, "next"),
    stale: false,
  }));
  catalog.start();
  catalog.loadMore("codex");
  await settled(catalog);
  expect(read.mock.calls).toEqual([["codex", "next"]]);
  expect(catalog.getSnapshot().providers.find((p) => p.id === "claude")?.hasMore).toBe(true);
  catalog.loadMore();
  await settled(catalog);
  expect(read.mock.calls).toEqual([
    ["codex", "next"],
    ["claude", "next"],
  ]);
  expect(catalog.getSnapshot().sessions).toHaveLength(4);
  catalog.loadMore();
  expect(read).toHaveBeenCalledTimes(2);
  catalog.stop();
});

it("deduplicates shifting pages and stops repeated cursors from loading forever", async () => {
  const read = vi.fn(async () => ({
    sessions: [session("same", "13"), session("older")],
    nextCursor: "repeated",
  }));
  const catalog = new SessionCatalog([providers[0]!], read, () => ({
    page: page("same", "repeated"),
    stale: false,
  }));
  catalog.start();
  catalog.loadMore();
  await settled(catalog);
  expect(catalog.getSnapshot().sessions.map((row) => row.id)).toEqual(["same", "older"]);
  expect(catalog.getSnapshot().sessions[0]?.updatedAt).toBe("2026-09-13T00:00:00Z");
  expect(catalog.getSnapshot().providers[0]?.hasMore).toBe(false);
  catalog.loadMore();
  expect(read).toHaveBeenCalledTimes(1);
  catalog.stop();
});

it("ignores stopped generations, including delayed failures after a restart", async () => {
  const old = deferred();
  const fresh = deferred();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const catalog = new SessionCatalog([providers[0]!], read, () => undefined);
  const listener = vi.fn();
  const unsubscribe = catalog.subscribe(listener);
  catalog.start();
  catalog.stop();
  catalog.start();
  fresh.resolve(page("fresh"));
  await settled(catalog);
  const snapshot = catalog.getSnapshot();
  listener.mockClear();
  old.reject(new Error("Stale failure"));
  await old.promise.catch(() => undefined);
  await Promise.resolve();
  expect(catalog.getSnapshot()).toBe(snapshot);
  expect(catalog.getSnapshot().sessions.map((row) => row.id)).toEqual(["fresh"]);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
  catalog.stop();
});
