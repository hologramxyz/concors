import { afterEach, expect, it, vi } from "vitest";
import { cachedSessions, cacheSessions, mergeSessions } from "./session-cache";

afterEach(() => vi.restoreAllMocks());
const session = (id: string, updatedAt = "2026-09-12T00:00:00Z") => ({
  id,
  title: id,
  directory: "/repo",
  updatedAt,
});
it("isolates cached pages between machines, epochs, providers and queries, and expires them", () => {
  const machine = {},
    another = {};
  const page = { sessions: [session("one")], nextCursor: "next" };
  cacheSessions(machine, "epoch:provider:directory:query", page);
  expect(cachedSessions(machine, "epoch:provider:directory:query")).toBe(page);
  expect(cachedSessions(another, "epoch:provider:directory:query")).toBeUndefined();
  expect(cachedSessions(machine, "other-epoch:provider:directory:query")).toBeUndefined();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
  expect(cachedSessions(machine, "epoch:provider:directory:query")).toBeUndefined();
});
it("deduplicates shifting pages and keeps newest metadata in recency order", () => {
  expect(
    mergeSessions([session("old"), session("new")], [session("new", "2026-09-13T00:00:00Z")]).map(
      (s) => s.id,
    ),
  ).toEqual(["new", "old"]);
});
