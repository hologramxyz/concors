import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentItem, AgentPending } from "@concors/protocol";
import { AgentsContext } from "@/agents/context";
import { TimelineItem } from "@/agents/timeline-item";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { SupervisorReferences } from "./reference-context";
import type { SupervisorReference } from "./reference-text";
import { SessionLinkContext } from "./session-link";
import { ANSWERED_TITLE, answeredNotice } from "./answered-notice";
import { PENDING_TITLE, pendingNotice, pendingWord, queuedWords } from "./pending-notice";

const SUPERVISOR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

function notice(text: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: `supervisor-watch:${SUPERVISOR}:${CHAT}:input:turn-1:approval-1`,
    sessionId: SUPERVISOR,
    turnId: "supervisor:watch-1",
    position: 0,
    revision: 0,
    kind: "system",
    title: PENDING_TITLE,
    text,
    detail: "",
    status: "completed",
    createdAt: "2026-11-24T00:00:00.000Z",
    origin: { supervisorId: SUPERVISOR, deliveryId: "watch-1" },
    ...overrides,
  };
}

const chat = `**Star Catcher / [Game QA](concors://session/${CHAT})**`;
const approval = (action: string, tail = "Answer it here or in that chat.") =>
  `${chat} needs your approval.\n\n> ${action}\n\n${tail}`;

describe("pendingNotice", () => {
  it("reads an approval's chat, request and command", () => {
    expect(pendingNotice(notice(approval("pnpm test")))).toEqual({
      sessionId: CHAT,
      requestId: "approval-1",
      kind: "approval",
      action: "pnpm test",
      command: true,
      file: null,
      answerable: true,
      queued: null,
    });
  });

  it("reads a file request as its tool and the file's name, not a command", () => {
    expect(pendingNotice(notice(approval("Write haiku.txt")))).toMatchObject({
      command: false,
      file: { tool: "Write", name: "haiku.txt" },
      answerable: true,
    });
  });

  it("reads a question as words, answered in its chat", () => {
    const text = `${chat} needs your input.\n\n> Which color?\n\nOpen that chat to respond.`;
    expect(pendingNotice(notice(text))).toMatchObject({
      kind: "question",
      action: "Which color?",
      command: false,
      file: null,
      answerable: false,
    });
  });

  it("reads a plan or mode approval as words, answered in its chat", () => {
    const read = pendingNotice(notice(approval("Ship the HUD", "Open that chat to respond.")));
    expect(read).toMatchObject({ kind: "approval", command: false, file: null, answerable: false });
  });

  it("keeps the daemon's sentence about instructions queued behind the request", () => {
    const tail = "Answer it here or in that chat. 2 follow-up instruction(s) are queued behind it.";
    expect(pendingNotice(notice(approval("pnpm test", tail)))?.queued).toBe(
      "2 follow-up instruction(s) are queued behind it.",
    );
  });

  it("keeps a quoted action's every line", () => {
    const text = `${chat} needs your approval.\n\n> echo one\n> echo two\n\nAnswer it here or in that chat.`;
    expect(pendingNotice(notice(text))?.action).toBe("echo one\necho two");
  });

  it("names the state in the client's words", () => {
    expect(pendingWord("approval")).toBe("Needs your approval");
    expect(pendingWord("question")).toBe("Needs your answer");
  });

  it.each([
    ["another title", notice(approval("pnpm test"), { title: "Agent result" })],
    ["no origin", notice(approval("pnpm test"), { origin: undefined })],
    ["not a system item", notice(approval("pnpm test"), { kind: "assistant" })],
    ["an ID of another shape", notice(approval("pnpm test"), { id: "supervisor-watch:x" })],
    ["a sentence for another chat", notice(approval("x").replace(CHAT, "someone-else"))],
    ["another sentence", notice(`${chat} is fine.\n\n> pnpm test\n\nOpen that chat to respond.`)],
    ["no quote", notice(`${chat} needs your approval.\n\npnpm test\n\nOpen that chat to respond.`)],
    ["an empty action", notice(`${chat} needs your approval.\n\n> \n\nOpen that chat to respond.`)],
    ["another last line", notice(approval("pnpm test", "Reply soon."))],
    ["more after it", notice(approval("pnpm test", "Answer it here or in that chat. And more."))],
    ["no last line", notice(`${chat} needs your approval.\n\n> pnpm test`)],
    [
      "a question claiming to be answerable here",
      notice(`${chat} needs your input.\n\n> Which?\n\nAnswer it here or in that chat.`),
    ],
  ])("draws the notice as written given %s", (_, item) => {
    expect(pendingNotice(item)).toBeNull();
  });
});

/**
 * The daemon's own watcher, given just enough of a store to post its notices: the client must
 * still read what it writes while a watched chat waits on a request, and once it is answered. It
 * is loaded by path at run time, since type-checking the daemon's sources belongs to the daemon's
 * own settings.
 */
describe("queuedWords", () => {
  it.each([
    ["1 follow-up instruction(s) are queued behind it.", "1 instruction queued behind this"],
    ["2 follow-up instruction(s) are queued behind it.", "2 instructions queued behind this"],
    ["12 follow-up instruction(s) are queued behind it.", "12 instructions queued behind this"],
  ])("reads %s as %s", (sentence, words) => expect(queuedWords(sentence)).toBe(words));

  it.each([
    "Some follow-up instructions are queued behind it.",
    "0 follow-up instruction(s) are queued behind it.",
    "2 follow-up instructions are waiting.",
    `${"9".repeat(30)} follow-up instruction(s) are queued behind it.`,
  ])("keeps %s as the daemon wrote it", (sentence) => expect(queuedWords(sentence)).toBe(sentence));
});

describe("the daemon's pending notice", () => {
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

  const request = (summary: string, detail = "{}", extra: object = {}): AgentPending =>
    ({
      id: "approval-1",
      turnId: "turn-1",
      kind: "approval",
      title: "Allow?",
      summary,
      detail,
      decisions: ["accept", "decline", "cancel"],
      questions: [],
      ...extra,
    }) as AgentPending;

  const question = {
    id: "question-1",
    turnId: "turn-1",
    kind: "questions",
    title: "Which color?",
    summary: "",
    detail: "{}",
    decisions: [],
    questions: [
      {
        id: "color",
        header: "Color",
        question: "Which color?",
        options: [{ label: "Blue", description: "Use blue" }],
      },
    ],
  } as unknown as AgentPending;

  /** The items the daemon posts while the request is open, then once the chat moves on. */
  async function posted(pending: AgentPending, extra: object = {}) {
    const path = new URL("../../../../packages/daemon/src/supervisor/watch.ts", import.meta.url)
      .href;
    const { SupervisorWatches } = (await import(/* @vite-ignore */ path)) as {
      SupervisorWatches: WatchesClass;
    };
    const records = new Map<string, unknown>();
    const items = new Map<string, AgentItem>();
    const agent = (id: string, more: object = {}) => ({
      id,
      projectId: "project-1",
      name: "Game QA",
      status: "working",
      turnId: "turn-1",
      pending: [],
      ...more,
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
      recordSupervisorUpdate: (_: string, item: AgentItem) => items.set(item.id, { ...item }),
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
    target = agent(CHAT, { status: "needs_input", pending: [pending], ...extra });
    watches.observe({ type: "agent.state", agent: target });
    const open = [...items.values()].find((item) => item.title === PENDING_TITLE);
    target = agent(CHAT);
    watches.observe({ type: "agent.state", agent: target });
    const answered = items.get(open?.id ?? "");
    return { open, answered };
  }

  it("is read as an approval for a command, answerable here", async () => {
    const { open } = await posted(request("pnpm test"));
    expect(open).toBeDefined();
    expect(pendingNotice(open!)).toEqual({
      sessionId: CHAT,
      requestId: "approval-1",
      kind: "approval",
      action: "pnpm test",
      command: true,
      file: null,
      answerable: true,
      queued: null,
    });
  });

  it("is read as an approval for a file", async () => {
    const input = JSON.stringify({ file_path: "/w/src/index.html", content: "<p>hi</p>" });
    const detail = JSON.stringify({ command: input, reason: "Write" });
    const { open } = await posted(request(`${input}\nWrite`, detail));
    expect(pendingNotice(open!)).toMatchObject({
      action: "Write index.html",
      command: false,
      file: { tool: "Write", name: "index.html" },
      answerable: true,
    });
  });

  it("keeps a long command whole", async () => {
    const command = `cd "/tmp/star-catcher" && for i in $(seq 1 60); do echo $i; done\necho done`;
    const { open } = await posted(request(JSON.stringify({ command })));
    expect(pendingNotice(open!)?.action).toBe(command);
  });

  it("is read as a question, answered in its chat", async () => {
    const { open } = await posted(question);
    expect(pendingNotice(open!)).toMatchObject({
      requestId: "question-1",
      kind: "question",
      action: "Which color?",
      answerable: false,
    });
  });

  it("is read as a plan approval, answered in its chat", async () => {
    const plan = request("Ship the HUD", "{}", { approvalKind: "plan", plan: "1. Ship" });
    expect(pendingNotice((await posted(plan)).open!)).toMatchObject({
      kind: "approval",
      action: "Ship the HUD",
      command: false,
      answerable: false,
    });
  });

  it("is read with instructions queued behind it", async () => {
    const { open } = await posted(request("pnpm test"), { queue: [{ id: "q-1" }, { id: "q-2" }] });
    expect(pendingNotice(open!)?.queued).toBe("2 follow-up instruction(s) are queued behind it.");
    expect(queuedWords(pendingNotice(open!)!.queued!)).toBe("2 instructions queued behind this");
  });

  it("is read with one instruction queued behind it", async () => {
    const { open } = await posted(request("pnpm test"), { queue: [{ id: "q-1" }] });
    expect(queuedWords(pendingNotice(open!)!.queued!)).toBe("1 instruction queued behind this");
  });

  it("becomes the answered notice under the same ID once answered", async () => {
    for (const pending of [request("pnpm test"), question]) {
      const { open, answered } = await posted(pending);
      expect(answered?.id).toBe(open?.id);
      expect(answered?.title).toBe(ANSWERED_TITLE);
      expect(pendingNotice(answered!)).toBeNull();
      expect(answeredNotice(answered!)?.sessionId).toBe(CHAT);
    }
  });
});

describe("the pending block", () => {
  const known = [
    { id: CHAT, kind: "Agent", label: "Game QA", workspace: "Star Catcher" },
  ] as SupervisorReference[];
  const pending = {
    id: "approval-1",
    turnId: "turn-1",
    kind: "approval",
    title: "Allow?",
    summary: "pnpm test",
    detail: "{}",
    decisions: ["accept", "decline", "cancel"],
    questions: [],
  } as unknown as AgentPending;
  const agent = {
    id: CHAT,
    provider: "codex",
    directory: "/w",
    pending: [pending],
  } as unknown as AgentInfo;
  const connection = { state: { status: "ready" } } as unknown as DaemonConnection;
  const render = (item: AgentItem) =>
    renderToStaticMarkup(
      createElement(
        TerminalConnectionContext,
        { value: connection },
        createElement(
          AgentsContext,
          { value: [agent] },
          createElement(
            SessionLinkContext,
            { value: () => undefined },
            createElement(
              SupervisorReferences,
              { value: known },
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

  it("reads the chat, then the state, then the command, then Allow once and Decline", () => {
    const html = render(notice(approval("pnpm test")));
    expect(text(html)).toBe(
      "Star Catcher / Game QA Needs your approval pnpm test Allow once Decline",
    );
    expect(html).toContain('aria-label="Game QA needs your approval"');
  });

  it("puts the instructions queued behind it under the command, above the buttons", () => {
    const tail = "Answer it here or in that chat. 2 follow-up instruction(s) are queued behind it.";
    expect(text(render(notice(approval("pnpm test", tail))))).toBe(
      "Star Catcher / Game QA Needs your approval pnpm test 2 instructions queued behind this Allow once Decline",
    );
  });

  it("offers Open chat under a question, as under a plan or mode approval", () => {
    const question = `${chat} needs your input.\n\n> Which color?\n\nOpen that chat to respond.`;
    expect(text(render(notice(question)))).toBe(
      "Star Catcher / Game QA Needs your answer Which color? Open chat",
    );
    expect(text(render(notice(approval("Ship the HUD", "Open that chat to respond."))))).toBe(
      "Star Catcher / Game QA Needs your approval Ship the HUD Open chat",
    );
  });
});
