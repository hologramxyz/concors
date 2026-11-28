import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentItem } from "@concors/protocol";
import { TimelineItem } from "@/agents/timeline-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupervisorReferences } from "./reference-context";
import type { SupervisorReference } from "./reference-text";
import { PAUSED_TITLE, pausedNotice, pausedRuns, pausedWords, waitingWords } from "./paused-notice";
import { AgentsContext } from "@/agents/context";
import { SessionLinkContext } from "./session-link";
import type { TimelineEntry } from "@/agents/thinking";

const SUPERVISOR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";
const ADVICE = "> Open the target chat to review its queue before resuming.";

function notice(text: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: `supervisor-watch:${SUPERVISOR}:${CHAT}:paused:turn-1:q-1:q-2`,
    sessionId: SUPERVISOR,
    turnId: "supervisor:watch-1",
    position: 0,
    revision: 0,
    kind: "system",
    title: PAUSED_TITLE,
    text,
    detail: "",
    status: "completed",
    createdAt: "2026-11-24T00:00:00.000Z",
    origin: { supervisorId: SUPERVISOR, deliveryId: "watch-1" },
    ...overrides,
  };
}

const chat = `**Star Catcher / [Game QA](concors://session/${CHAT})**`;
const paused = (count: string | number) =>
  `${chat} has ${count} paused instruction(s).\n\n${ADVICE}`;

describe("pausedNotice", () => {
  it("reads the chat and how many instructions are paused", () => {
    expect(pausedNotice(notice(paused(2)))).toEqual({ sessionId: CHAT, count: 2, error: null });
  });

  it("reads a notice whose turn left no ID", () => {
    const id = `supervisor-watch:${SUPERVISOR}:${CHAT}:paused:undefined:q-1`;
    expect(pausedNotice(notice(paused(1), { id }))).toEqual({
      sessionId: CHAT,
      count: 1,
      error: null,
    });
  });

  it("reads a number it cannot use as no number", () => {
    expect(pausedNotice(notice(paused("some")))?.count).toBeNull();
    expect(pausedNotice(notice(paused(0)))?.count).toBeNull();
  });

  it("reads the chat's error in the advice's place, every line of it", () => {
    const text = `${chat} has 2 paused instruction(s).\n\n> Provider exited\n> with code 1`;
    expect(pausedNotice(notice(text))).toEqual({
      sessionId: CHAT,
      count: 2,
      error: "Provider exited\nwith code 1",
    });
  });

  describe("leaves to the notice as written", () => {
    it.each([
      ["another title", notice(paused(2), { title: "Agent result" })],
      ["no origin", notice(paused(2), { origin: undefined })],
      ["another kind", notice(paused(2), { kind: "assistant" })],
      ["another ID", notice(paused(2), { id: `supervisor-watch:${SUPERVISOR}:${CHAT}:t:done` })],
      [
        "a link to another chat",
        notice(paused(2).replace(CHAT, "33333333-3333-4333-8333-333333333333")),
      ],
      ["other wording", notice(`${chat} has 2 queued instructions.\n\n${ADVICE}`)],
      ["no advice", notice(`${chat} has 2 paused instruction(s).`)],
      ["an unquoted line", notice(`${chat} has 2 paused instruction(s).\n\nProvider exited`)],
      ["an empty quote", notice(`${chat} has 2 paused instruction(s).\n\n> `)],
      ["more after the advice", notice(`${paused(2)}\n\nResume it soon.`)],
    ])("%s", (_, item) => expect(pausedNotice(item)).toBeNull());
  });
});

describe("pausedWords and waitingWords", () => {
  it.each([
    [1, "1 instruction paused"],
    [3, "3 instructions paused"],
    [null, "Queue paused"],
  ])("says %s as %s", (count, words) => expect(pausedWords(count)).toBe(words));

  it.each([
    [1, "1 instruction waiting"],
    [3, "3 instructions waiting"],
  ])("says %s as %s", (count, words) => expect(waitingWords(count)).toBe(words));
});

const OTHER = "33333333-3333-4333-8333-333333333333";
const other = `**Star Catcher / [HUD polish](concors://session/${OTHER})**`;
const at = (n: number, sessionId = CHAT, error?: string) =>
  notice(
    `${sessionId === CHAT ? chat : other} has ${n} paused instruction(s).\n\n${error ? `> ${error}` : ADVICE}`,
    { id: `supervisor-watch:${SUPERVISOR}:${sessionId}:paused:turn-${n}:q-${n}` },
  );

describe("pausedRuns", () => {
  const reply = { ...notice("Done."), id: "reply", title: "Codex", kind: "assistant" as const };
  const later = (view: TimelineEntry[]) => pausedRuns(view).map((entry) => !!entry.pausedLater);

  it("leaves only each chat's most recent paused notice able to ask for a person", () => {
    expect(later([at(1), at(2), at(3)])).toEqual([true, true, false]);
  });

  it("looks past other rows and other chats' notices between them", () => {
    expect(later([at(1), reply, at(2)])).toEqual([true, false, false]);
    expect(later([at(1), at(2, OTHER), at(3)])).toEqual([true, false, false]);
  });

  it("keeps every notice in its place", () => {
    const view = [at(1), reply, at(2), at(3)];
    expect(pausedRuns(view).map((entry) => entry.id)).toEqual(view.map((entry) => entry.id));
  });
});

describe("the paused row", () => {
  const known: SupervisorReference[] = [
    { id: CHAT, kind: "Agent", label: "Game QA", workspace: "Star Catcher" } as SupervisorReference,
  ];
  const chatState = (more: Partial<AgentInfo> = {}) =>
    ({
      id: CHAT,
      provider: "codex",
      queuePaused: true,
      queue: [{ id: "q-1" }],
      ...more,
    }) as unknown as AgentInfo;
  const render = (item: TimelineEntry, { references = known, agents = [chatState()] } = {}) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          AgentsContext,
          { value: agents },
          createElement(
            SessionLinkContext,
            { value: () => undefined },
            createElement(
              SupervisorReferences,
              { value: references },
              createElement(TimelineItem, { item, live: false }),
            ),
          ),
        ),
      ),
    );
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("asks for a person while its chat's queue is still paused: state, what waits, Review queue", () => {
    const html = render(at(2));
    expect(text(html)).toBe(
      "Star Catcher / Game QA Queue paused 2 instructions waiting Review queue",
    );
    expect(html).toContain('aria-label="Game QA queue paused"');
    expect(html).toContain("bg-destructive"); // the attention dot
    expect(html).not.toContain("review its queue");
    expect(html).not.toContain("<blockquote");
  });

  it("shows the chat's error, muted, under what waits", () => {
    const html = render(at(1, CHAT, "Provider exited"));
    expect(text(html)).toBe(
      "Star Catcher / Game QA Queue paused 1 instruction waiting Provider exited Review queue",
    );
  });

  it("says only that the queue is paused when the daemon's number cannot be read", () => {
    expect(text(render(notice(paused("some"))))).toBe(
      "Star Catcher / Game QA Queue paused Review queue",
    );
  });

  it.each([
    ["a later paused notice of its chat", { pausedLater: true as const }, [chatState()]],
    ["a resumed queue", {}, [chatState({ queuePaused: false })]],
    ["an emptied queue", {}, [chatState({ queue: [] })]],
    ["a chat whose queue state is not known", {}, [chatState({ queuePaused: undefined })]],
  ])("is one quiet row after %s, with no action", (_, extra, agents) => {
    const html = render({ ...at(2), ...extra }, { agents });
    expect(text(html)).toBe("Star Catcher / Game QA 2 instructions paused");
    expect(html).not.toContain("bg-destructive");
  });

  it("is drawn as written when its chat is unknown", () => {
    const html = render(at(2), { references: [] });
    expect(html).toContain("<blockquote");
    expect(text(html)).toContain("has 2 paused instruction(s).");
    expect(text(html)).toContain("Open the target chat to review its queue before resuming.");
  });
});

/**
 * The daemon's own watcher, given just enough of a store to post its notices: the client must
 * still read what it writes when a watched chat's queue is paused, and a change to its wording
 * fails here. It is loaded by path at run time, as in answered-notice.test.ts.
 */
describe("the daemon's paused notice", () => {
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

  async function pausedItem(after: object) {
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
      agentTurnItems: () => [],
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
    return [...items.values()].find((item) => item.title === PAUSED_TITLE);
  }

  it("is read with one instruction paused", async () => {
    const item = await pausedItem({
      status: "interrupted",
      queuePaused: true,
      queue: [{ id: "q-1" }],
    });
    expect(item).toBeDefined();
    expect(pausedNotice(item!)).toEqual({ sessionId: CHAT, count: 1, error: null });
    expect(pausedWords(pausedNotice(item!)!.count)).toBe("1 instruction paused");
  });

  it("is read with several instructions paused", async () => {
    const item = await pausedItem({
      status: "done",
      queuePaused: true,
      queue: [{ id: "q-1" }, { id: "q-2" }, { id: "q-3" }],
    });
    expect(pausedWords(pausedNotice(item!)!.count)).toBe("3 instructions paused");
  });

  it("is read with the chat's error in the advice's place", async () => {
    const item = await pausedItem({
      status: "failed",
      queuePaused: true,
      queue: [{ id: "q-1" }],
      error: "Provider exited with code 1",
    });
    expect(pausedNotice(item!)).toEqual({
      sessionId: CHAT,
      count: 1,
      error: "Provider exited with code 1",
    });
  });
});
