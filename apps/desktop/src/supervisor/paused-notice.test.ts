import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { TimelineItem } from "@/agents/timeline-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupervisorReferences } from "./reference-context";
import type { SupervisorReference } from "./reference-text";
import { PAUSED_TITLE, pausedNotice, pausedRuns, pausedWords } from "./paused-notice";
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
    expect(pausedNotice(notice(paused(2)))).toEqual({ sessionId: CHAT, count: 2 });
  });

  it("reads a notice whose turn left no ID", () => {
    const id = `supervisor-watch:${SUPERVISOR}:${CHAT}:paused:undefined:q-1`;
    expect(pausedNotice(notice(paused(1), { id }))).toEqual({ sessionId: CHAT, count: 1 });
  });

  it("reads a number it cannot use as no number", () => {
    expect(pausedNotice(notice(paused("some")))).toEqual({ sessionId: CHAT, count: null });
    expect(pausedNotice(notice(paused(0)))?.count).toBeNull();
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
      [
        "the chat's error in place of the advice",
        notice(`${chat} has 2 paused instruction(s).\n\n> Provider exited`),
      ],
      ["other wording", notice(`${chat} has 2 queued instructions.\n\n${ADVICE}`)],
      ["no advice", notice(`${chat} has 2 paused instruction(s).`)],
      ["more after the advice", notice(`${paused(2)}\n\nResume it soon.`)],
    ])("%s", (_, item) => expect(pausedNotice(item)).toBeNull());
  });
});

describe("pausedWords", () => {
  it.each([
    [1, "1 instruction paused"],
    [3, "3 instructions paused"],
    [null, "Queue paused"],
  ])("says %s as %s", (count, words) => expect(pausedWords(count)).toBe(words));
});

describe("pausedRuns", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const other = `**Star Catcher / [HUD polish](concors://session/${OTHER})**`;
  const at = (n: number, sessionId = CHAT) =>
    notice(`${sessionId === CHAT ? chat : other} has ${n} paused instruction(s).\n\n${ADVICE}`, {
      id: `supervisor-watch:${SUPERVISOR}:${sessionId}:paused:turn-${n}:q-${n}`,
    });
  const reply = { ...notice("Done."), id: "reply", title: "Codex", kind: "assistant" as const };
  const later = (view: TimelineEntry[]) => pausedRuns(view).map((entry) => !!entry.pausedLater);

  it("leaves the review on only the last of a chat's paused notices in a row", () => {
    expect(later([at(1), at(2), at(3)])).toEqual([true, true, false]);
  });

  it("keeps it on each when something else, or another chat's, sits between them", () => {
    expect(later([at(1), reply, at(2)])).toEqual([false, false, false]);
    expect(later([at(1), at(2, OTHER), at(3)])).toEqual([false, false, false]);
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
  const render = (item: AgentItem, references = known) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          SupervisorReferences,
          { value: references },
          createElement(TimelineItem, { item, live: false }),
        ),
      ),
    );
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

  it("is one row: the chat, then how many instructions are paused", () => {
    const html = render(notice(paused(1)));
    expect(text(html)).toBe("Star Catcher / Game QA1 instruction paused");
    expect(html).toContain('aria-label="Game QA 1 instruction paused"');
    expect(html).not.toContain("review its queue");
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("text-destructive");
  });

  it("offers Review queue, which opens the chat as its name does", () => {
    const opened: string[] = [];
    const html = renderToStaticMarkup(
      createElement(
        SessionLinkContext,
        { value: (id: string) => opened.push(id) },
        createElement(
          SupervisorReferences,
          { value: known },
          createElement(TimelineItem, { item: notice(paused(1)), live: false }),
        ),
      ),
    );
    expect(text(html)).toBe("Star Catcher / Game QA1 instruction pausedReview queue");
  });

  it("leaves Review queue to the chat's next paused notice", () => {
    const item: TimelineEntry = { ...notice(paused(1)), pausedLater: true };
    const html = renderToStaticMarkup(
      createElement(
        SessionLinkContext,
        { value: () => undefined },
        createElement(
          SupervisorReferences,
          { value: known },
          createElement(TimelineItem, { item, live: false }),
        ),
      ),
    );
    expect(text(html)).toBe("Star Catcher / Game QA1 instruction paused");
  });

  it("says the queue is paused when the number cannot be read", () => {
    expect(text(render(notice(paused("some"))))).toBe("Star Catcher / Game QAQueue paused");
  });

  it("is drawn as written when its chat is unknown", () => {
    const html = render(notice(paused(2)), []);
    expect(html).toContain("<blockquote");
    expect(text(html)).toContain("has 2 paused instruction(s).");
    expect(text(html)).toContain("Open the target chat to review its queue before resuming.");
  });

  it("is drawn as written when the chat's error takes the advice's place", () => {
    const html = render(notice(`${chat} has 2 paused instruction(s).\n\n> Provider exited`));
    expect(text(html)).toContain("has 2 paused instruction(s).");
    expect(text(html)).toContain("Provider exited");
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
    expect(pausedNotice(item!)).toEqual({ sessionId: CHAT, count: 1 });
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

  it("is drawn as written when the chat's error takes the advice's place", async () => {
    const item = await pausedItem({
      status: "failed",
      queuePaused: true,
      queue: [{ id: "q-1" }],
      error: "Provider exited with code 1",
    });
    expect(item?.text).toContain("Provider exited with code 1");
    expect(pausedNotice(item!)).toBeNull();
  });
});
