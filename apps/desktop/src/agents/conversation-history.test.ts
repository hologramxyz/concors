import { expect, it, vi } from "vitest";
import { AgentInfoSchema, type AgentConversation, type AgentItem } from "@concors/protocol";
import { ConversationHistory, HISTORY_WINDOW, type HistoryCursor } from "./conversation-history";

const id = "00000000-0000-4000-8000-000000000001";
const agent = AgentInfoSchema.parse({
  id,
  projectId: id,
  provider: "codex",
  name: "History",
  directory: "/test",
  model: null,
  threadId: "thread",
  turnId: null,
  status: "idle",
  error: null,
  revision: 0,
  pending: [],
  startedAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  turnStartedAt: null,
});
function item(position: number): AgentItem {
  return {
    id: String(position),
    sessionId: id,
    position,
    revision: 0,
    turnId: String(position),
    kind: "assistant",
    title: "Codex",
    text: `Message ${position}`,
    detail: "",
    status: "completed",
    createdAt: agent.startedAt,
  };
}
function fixture(count = 800) {
  const all = Array.from({ length: count }, (_, position) => item(position));
  const page = ({ before, after }: HistoryCursor = {}): AgentConversation => {
    const matching = all.filter(
      (item) =>
        (before === undefined || item.position < before) &&
        (after === undefined || item.position > after),
    );
    const items = after === undefined ? matching.slice(-80) : matching.slice(0, 80);
    return {
      agent,
      items,
      hasMore: (items[0]?.position ?? 0) > 0,
      hasNewer: (items.at(-1)?.position ?? Infinity) < all.length - 1,
    };
  };
  const read = vi.fn(async (cursor: HistoryCursor) => page(cursor));
  return { all, page, read, history: new ConversationHistory(read) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("walks all history in both directions without gaps, duplicates or an unbounded window", async () => {
  const { history, all } = fixture();
  await history.load("latest");
  expect(history.getSnapshot().items).toEqual(all.slice(-80));
  history.setFollowing(false);
  while (history.getSnapshot().hasEarlier) {
    await history.load("earlier");
    const { items } = history.getSnapshot();
    expect(items.length).toBeLessThanOrEqual(HISTORY_WINDOW);
    expect(items).toEqual(all.slice(items[0]!.position, items.at(-1)!.position + 1));
  }
  expect(history.getSnapshot().items[0]?.position).toBe(0);
  expect(history.getSnapshot().hasNewer).toBe(true);
  while (history.getSnapshot().hasNewer) {
    await history.load("newer");
    const { items } = history.getSnapshot();
    expect(items.length).toBeLessThanOrEqual(HISTORY_WINDOW);
    expect(items).toEqual(all.slice(items[0]!.position, items.at(-1)!.position + 1));
  }
  expect(history.getSnapshot().items.at(-1)?.position).toBe(799);
});
it("deduplicates simultaneous edge loads and preserves newer streamed revisions", async () => {
  const { history, read, page } = fixture();
  await history.load("latest");
  const pending = deferred<AgentConversation>();
  read.mockImplementationOnce(() => pending.promise);
  const older = history.load("earlier");
  await history.load("earlier");
  await history.load("newer");
  expect(read).toHaveBeenCalledTimes(2);
  history.receive({ ...item(799), text: "Streamed update", revision: 2 });
  pending.resolve(page({ before: 720 }));
  await older;
  expect(history.getSnapshot().items.at(-1)?.text).toBe("Streamed update");
});
it("does not splice live replies into an older window and can jump to the actual latest page", async () => {
  const { history, all } = fixture();
  await history.load("latest");
  for (let i = 0; i < 4; i++) await history.load("earlier");
  const old = history.getSnapshot().items;
  all.push(item(800));
  history.receive(all.at(-1)!);
  expect(history.getSnapshot().items).toEqual(old);
  await history.load("latest");
  expect(history.getSnapshot().items).toEqual(all.slice(-80));
  expect(history.getSnapshot().hasNewer).toBe(false);
});
it("discards a pending old-history page when compaction or truncation changes history", async () => {
  const { history, page, read } = fixture();
  await history.load("latest");
  const pending = deferred<AgentConversation>();
  read.mockImplementationOnce(() => pending.promise);
  const older = history.load("earlier");
  const replacement = {
    agent: { ...agent, historyRevision: 1 },
    items: [item(900)],
    hasMore: false,
    hasNewer: false,
  };
  read.mockResolvedValueOnce(replacement);
  history.invalidate(replacement.agent);
  await vi.waitFor(() => expect(history.getSnapshot().items).toEqual(replacement.items));
  pending.resolve(page({ before: 720 }));
  await older;
  expect(history.getSnapshot().items).toEqual(replacement.items);
});
it("refreshes from a changed history revision found in a page response", async () => {
  const { history, read, page } = fixture();
  await history.load("latest");
  const changed = { ...page({ before: 720 }), agent: { ...agent, historyRevision: 2 } };
  read.mockResolvedValueOnce(changed).mockResolvedValueOnce({ ...changed, items: [item(900)] });
  await history.load("earlier");
  await vi.waitFor(() => expect(history.getSnapshot().items).toEqual([item(900)]));
});
it("keeps history on failure and retries the same forward cursor", async () => {
  const { history, read } = fixture();
  await history.load("latest");
  for (let i = 0; i < 4; i++) await history.load("earlier");
  const before = history.getSnapshot().items;
  read.mockRejectedValueOnce(new Error("Connection interrupted"));
  await history.load("newer");
  expect(history.getSnapshot().items).toEqual(before);
  expect(history.getSnapshot().error).toEqual({
    direction: "newer",
    message: "Connection interrupted",
  });
  const cursor = read.mock.calls.at(-1)?.[0];
  await history.load("newer");
  expect(read.mock.calls.at(-1)?.[0]).toEqual(cursor);
  expect(history.getSnapshot().error).toBeNull();
});
it("ignores responses after cancellation or after jumping to latest", async () => {
  const { history, read, page } = fixture();
  await history.load("latest");
  const pending = deferred<AgentConversation>();
  read.mockImplementationOnce(() => pending.promise);
  const older = history.load("earlier");
  history.cancel();
  await history.load("latest");
  pending.resolve(page({ before: 720 }));
  await older;
  expect(history.getSnapshot().items).toEqual(page().items);
});
it("retains loaded history with legacy daemons instead of issuing unsupported forward requests", async () => {
  const { page } = fixture();
  const read = vi.fn(async (cursor: HistoryCursor) => {
    const { hasNewer: _, ...legacy } = page(cursor);
    return legacy;
  });
  const history = new ConversationHistory(read);
  await history.load("latest");
  while (history.getSnapshot().hasEarlier) await history.load("earlier");
  expect(history.getSnapshot().items).toHaveLength(800);
  await history.load("newer");
  expect(read.mock.calls.every(([cursor]) => cursor.after === undefined)).toBe(true);
});
it("bounds streaming at the tail, but keeps a reader's older messages when they scroll away", async () => {
  const { history } = fixture(240);
  await history.load("latest");
  await history.load("earlier");
  await history.load("earlier");
  history.receive(item(240));
  expect(history.getSnapshot().items[0]?.position).toBe(1);
  expect(history.getSnapshot().items).toHaveLength(HISTORY_WINDOW);
  history.setFollowing(false);
  history.receive(item(241));
  expect(history.getSnapshot().items.at(-1)?.position).toBe(240);
  expect(history.getSnapshot().hasNewer).toBe(true);
});
it("jumps directly to indexed messages in either direction and resumes contiguous paging", async () => {
  const { history, all, read } = fixture();
  await history.load("latest");
  await history.reveal(100);
  expect(read).toHaveBeenNthCalledWith(2, { before: 101 });
  expect(read).toHaveBeenLastCalledWith({ after: 100 });
  expect(history.getSnapshot().items).toEqual(all.slice(21, 181));
  expect(history.getSnapshot().hasNewer).toBe(true);
  await history.load("newer");
  expect(history.getSnapshot().items).toEqual(all.slice(21, 261));
  await history.reveal(600);
  expect(read).toHaveBeenLastCalledWith({ after: 600 });
  expect(history.getSnapshot().items).toEqual(all.slice(521, 681));
  await history.load("earlier");
  expect(history.getSnapshot().items).toEqual(all.slice(441, 681));
  expect(history.getSnapshot().items.length).toBeLessThanOrEqual(HISTORY_WINDOW);
});
it("supersedes pending edge loads when jumping, including to already loaded messages", async () => {
  const { history, page, read } = fixture();
  await history.load("latest");
  const pending = deferred<AgentConversation>();
  read.mockImplementationOnce(() => pending.promise);
  const older = history.load("earlier");
  await history.reveal(100);
  const jumped = history.getSnapshot().items;
  pending.resolve(page({ before: 720 }));
  await older;
  expect(history.getSnapshot().items).toEqual(jumped);
  const later = deferred<AgentConversation>();
  read.mockImplementationOnce(() => later.promise);
  const newer = history.load("newer");
  await history.reveal(100);
  later.resolve(page({ after: 100 }));
  await newer;
  expect(history.getSnapshot().items).toEqual(jumped);
  expect(history.getSnapshot().loading).toBeNull();
});
it("keeps the visible window when an indexed jump fails and permits retry", async () => {
  const { history, read, all } = fixture();
  await history.load("latest");
  const current = history.getSnapshot().items;
  read.mockRejectedValueOnce(new Error("Connection interrupted"));
  await expect(history.reveal(100)).rejects.toThrow("Connection interrupted");
  expect(history.getSnapshot().items).toEqual(current);
  expect(history.getSnapshot().loading).toBeNull();
  await history.reveal(100);
  expect(history.getSnapshot().items).toEqual(all.slice(21, 181));
});
it("rejects stale indexed jumps after history changes without restoring deleted messages", async () => {
  const { history, read, page } = fixture();
  await history.load("latest");
  const pending = deferred<AgentConversation>();
  read.mockImplementationOnce(() => pending.promise);
  const jumped = expect(history.reveal(100)).rejects.toThrow("Conversation changed");
  const replacement = { ...page(), agent: { ...agent, historyRevision: 1 }, items: [item(900)] };
  read.mockResolvedValueOnce(replacement);
  history.invalidate(replacement.agent);
  await vi.waitFor(() => expect(history.getSnapshot().items).toEqual(replacement.items));
  pending.resolve(page({ before: 101 }));
  await jumped;
  expect(history.getSnapshot().items).toEqual(replacement.items);
});
it("keeps a contiguous tail when jumping on a backward-only daemon", async () => {
  const { page, all } = fixture();
  const read = vi.fn(async (cursor: HistoryCursor) => {
    const { hasNewer: _, ...legacy } = page(cursor);
    return legacy;
  });
  const history = new ConversationHistory(read);
  await history.load("latest");
  await history.reveal(0);
  expect(history.getSnapshot().items).toEqual(all);
  expect(history.getSnapshot().hasEarlier).toBe(false);
  expect(read.mock.calls.every(([cursor]) => cursor.after === undefined)).toBe(true);
});
it("resumes after a reconnect with only the missed tail, keeping the reader's place", async () => {
  const { all, history, read } = fixture(300);
  await history.load("latest");
  await history.load("earlier");
  const { reset, items } = history.getSnapshot();
  history.cancel();
  all.push(item(300), item(301));
  await history.resume();
  expect(read.mock.calls.at(-1)?.[0]).toEqual({ after: 299 });
  const next = history.getSnapshot();
  expect(next.reset).toBe(reset);
  expect(next.items[0]).toEqual(items[0]);
  expect(next.items.at(-1)?.position).toBe(301);
});
it("does not fetch on resume while the reader is paged away from the tail", async () => {
  const { history, read } = fixture();
  await history.load("latest");
  for (let i = 0; i < 4; i++) await history.load("earlier");
  expect(history.getSnapshot().hasNewer).toBe(true);
  const calls = read.mock.calls.length;
  await history.resume();
  expect(read).toHaveBeenCalledTimes(calls);
});
