import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { FINISHED_TITLE, finishedNotice, finishedWord } from "./finished-notice";

const SUPERVISOR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

function notice(text: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:done`,
    sessionId: SUPERVISOR,
    turnId: "supervisor:watch-1",
    position: 0,
    revision: 0,
    kind: "system",
    title: FINISHED_TITLE,
    text,
    detail: "",
    status: "completed",
    createdAt: "2026-11-24T00:00:00.000Z",
    origin: { supervisorId: SUPERVISOR, deliveryId: "watch-1" },
    ...overrides,
  };
}

const sentence = (word = "finished") =>
  `**Star Catcher / [Game QA](concors://session/${CHAT})** ${word}.`;
const haiku = "Maple leaves let go\ndrifting on the cooling wind\ndusk arrives sooner";
const quoted = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

describe("finishedNotice", () => {
  it("reads a reply under the label, keeping its line breaks", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n${quoted(`Saved it:\n\n${haiku}`)}`;
    expect(finishedNotice(notice(text))).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: `Saved it:\n\n${haiku}`,
      cut: false,
    });
  });

  it("reads a notice without a reply as the row alone", () => {
    const text = `${sentence()}\n\nNo final text reply was saved. Open the chat for its tool output.`;
    expect(finishedNotice(notice(text))).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: null,
      cut: false,
    });
  });

  it("tells a reply the daemon cut short", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n> Part one\n\nRead the original chat for the full reply.`;
    expect(finishedNotice(notice(text))).toMatchObject({ quote: "Part one", cut: true });
  });

  it("reads a failed chat's error, quoted with no label", () => {
    const text = `${sentence("failed")}\n\n> Provider exited with code 1`;
    const item = notice(text, { id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:failed` });
    expect(finishedNotice(item)).toEqual({
      sessionId: CHAT,
      state: "failed",
      quote: "Provider exited with code 1",
      cut: false,
    });
  });

  it("reads an interrupted chat, with or without a reply", () => {
    const id = `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:interrupted`;
    const none = `${sentence("interrupted")}\n\nNo final text reply was saved. Open the chat for its tool output.`;
    expect(finishedNotice(notice(none, { id }))).toMatchObject({
      state: "interrupted",
      quote: null,
    });
    const reply = `${sentence("interrupted")}\n\nAgent’s reply:\n\n> Halfway`;
    expect(finishedNotice(notice(reply, { id }))).toMatchObject({ quote: "Halfway" });
  });

  it("names each ending as a step's row does", () => {
    expect(["done", "failed", "interrupted"].map((s) => finishedWord(s as never))).toEqual([
      "Finished",
      "Failed",
      "Stopped",
    ]);
  });

  describe("leaves to the notice as written", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n> Done.`;
    it.each([
      ["another title", notice(text, { title: "Input no longer pending" })],
      ["a message that is not Supervisor's", notice(text, { origin: undefined })],
      ["not a system line", notice(text, { kind: "assistant" })],
      ["an ID with no ending", notice(text, { id: `supervisor-watch:${SUPERVISOR}:${CHAT}` })],
      ["an ID with an unknown ending", notice(text, { id: `supervisor-watch:a:${CHAT}:t:paused` })],
      ["a sentence for another ending", notice(text.replace("finished.", "failed."))],
      ["a sentence linking another chat", notice(text.replace(CHAT, "someone-else"))],
      ["no body", notice(sentence())],
      ["a reply that is not quoted", notice(`${sentence()}\n\nAgent’s reply:\n\nDone.`)],
      ["an empty reply", notice(`${sentence()}\n\nAgent’s reply:\n\n> `)],
      ["text after the reply", notice(`${text}\n\nSomething else.`)],
      ["other wording", notice(`${sentence()}\n\nNo reply was saved.`)],
    ])("%s", (_, item) => expect(finishedNotice(item)).toBeNull());
  });
});

/**
 * The daemon's own watcher, given just enough of a store to post its notices: the client must
 * still read what it writes when a watched chat's turn ends, and a change to its wording fails
 * here. It is loaded by path at run time, as in answered-notice.test.ts.
 */
describe("the daemon's finished notice", () => {
  interface Watches {
    track(supervisorId: string, sessionId: string, id: string): void;
    observe(event: unknown): void;
  }
  type WatchesClass = new (
    store: unknown,
    agents: unknown,
    source: (id: string) => unknown,
    target: (id: string) => unknown,
    delivering: () => boolean,
    selected: () => Set<string>,
  ) => Watches;

  async function ended(after: object, reply?: string) {
    const path = new URL("../../../../packages/daemon/src/supervisor/watch.ts", import.meta.url)
      .href;
    const { SupervisorWatches } = (await import(/* @vite-ignore */ path)) as {
      SupervisorWatches: WatchesClass;
    };
    const records = new Map<string, unknown>();
    const items = new Map<string, AgentItem>();
    const agent = (id: string, extra: object = {}) => ({
      id,
      projectId: "project-1",
      name: "Game QA",
      status: "working",
      turnId: "turn-1",
      pending: [],
      ...extra,
    });
    let target = agent(CHAT);
    const store = {
      keepAgents: () => undefined,
      supervisorRecord: (key: string) => records.get(key),
      supervisorRecords: (prefix: string) =>
        [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value),
      saveSupervisorRecord: (key: string, value: unknown) => records.set(key, value),
      agentItem: (_: string, id: string) => items.get(id),
      agent: (id: string) => (id === CHAT ? target : agent(id)),
      agentTurnItems: () => (reply === undefined ? [] : [{ kind: "assistant", text: reply }]),
      snapshot: () => ({ projects: [{ id: "project-1", name: "Star Catcher" }] }),
    };
    const agents = {
      recordSupervisorUpdate: (_: string, item: AgentItem) => items.set(item.id, item),
    };
    const watches = new SupervisorWatches(
      store,
      agents,
      (id) => agent(id),
      () => target,
      () => false,
      () => new Set([SUPERVISOR]),
    );
    watches.track(SUPERVISOR, CHAT, "watch-1");
    target = agent(CHAT, after);
    watches.observe({ type: "agent.state", agent: target });
    return [...items.values()].find((item) => item.title === FINISHED_TITLE);
  }

  it("is read with its reply, line breaks and all", async () => {
    const item = await ended({ status: "done" }, `I saved this haiku:\n\n${haiku}`);
    expect(item).toBeDefined();
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: `I saved this haiku:\n\n${haiku}`,
      cut: false,
    });
  });

  it("is read without a reply", async () => {
    const item = await ended({ status: "done" });
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: null,
      cut: false,
    });
  });

  it("is read with a reply the daemon cut short", async () => {
    const item = await ended({ status: "done" }, "word ".repeat(1000));
    expect(finishedNotice(item!)).toMatchObject({ cut: true });
    expect(finishedNotice(item!)?.quote).toHaveLength(3000);
  });

  it("is read when the chat failed, with its error", async () => {
    const item = await ended({ status: "failed", error: "Provider exited with code 1" });
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "failed",
      quote: "Provider exited with code 1",
      cut: false,
    });
  });

  it("is read when the chat was interrupted", async () => {
    const item = await ended({ status: "interrupted" });
    expect(finishedNotice(item!)).toMatchObject({ state: "interrupted", quote: null });
  });
});
