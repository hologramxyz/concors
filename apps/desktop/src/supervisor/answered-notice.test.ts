import { describe, expect, it } from "vitest";
import type { AgentItem, AgentPending } from "@concors/protocol";
import { answeredNotice, answeredRuns, answeredSummary, ANSWERED_TITLE } from "./answered-notice";

const SUPERVISOR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

type Row = AgentItem & { answered?: Row[] };

function notice(text: string, overrides: Partial<AgentItem> = {}): Row {
  return {
    id: `supervisor-watch:${SUPERVISOR}:${CHAT}:input:turn-1:approval-1`,
    sessionId: SUPERVISOR,
    turnId: "supervisor:watch-1",
    position: 0,
    revision: 0,
    kind: "system",
    title: ANSWERED_TITLE,
    text,
    detail: "",
    status: "completed",
    createdAt: "2026-11-24T00:00:00.000Z",
    origin: { supervisorId: SUPERVISOR, deliveryId: "watch-1" },
    ...overrides,
  };
}

const sentence = `**Star Catcher / [Game QA](concors://session/${CHAT})** is no longer waiting for that approval and has resumed.`;

describe("answeredNotice", () => {
  it("reads the chat from the ID and the action from the quote", () => {
    expect(answeredNotice(notice(`${sentence}\n\n> pnpm test`))).toEqual({
      sessionId: CHAT,
      kind: "approval",
      action: "pnpm test",
      command: true,
    });
  });

  it("tells an answered question by the daemon's phrase, and reads it in the normal font", () => {
    const asked = `**Star Catcher / [Game QA](concors://session/${CHAT})** is no longer waiting for that input.`;
    expect(answeredNotice(notice(`${asked}\n\n> Which color?`))).toEqual({
      sessionId: CHAT,
      kind: "question",
      action: "Which color?",
      command: false,
    });
  });

  it("calls a notice with neither phrase a request, read as before", () => {
    const read = answeredNotice(notice(`Something else entirely.\n\n> pnpm test`));
    expect(read).toMatchObject({ kind: "request", action: "pnpm test", command: true });
  });

  it("reads only the sentence for the phrase, not the quote", () => {
    const quoted = `Something else.\n\n> echo "is no longer waiting for that input"`;
    expect(answeredNotice(notice(quoted))?.kind).toBe("request");
  });

  it("keeps a quoted action's every line", () => {
    const read = answeredNotice(notice(`${sentence}\n\n> cat <<EOF\n> one\n>\n> two\n> EOF`));
    expect(read?.action).toBe("cat <<EOF\none\n\ntwo\nEOF");
  });

  it("tells a file request from a command", () => {
    expect(answeredNotice(notice(`${sentence}\n\n> Write haiku.txt`))?.command).toBe(false);
    expect(answeredNotice(notice(`${sentence}\n\n> Edit index.html`))?.command).toBe(false);
    expect(answeredNotice(notice(`${sentence}\n\n> echo test`))?.command).toBe(true);
    expect(answeredNotice(notice(`${sentence}\n\n> Write a/b.txt && rm x`))?.command).toBe(true);
  });

  describe("leaves to the notice as written", () => {
    const text = `${sentence}\n\n> pnpm test`;
    it.each([
      ["another title", notice(text, { title: "Agent needs your input" })],
      ["a message that is not Supervisor's", notice(text, { origin: undefined })],
      ["not a system line", notice(text, { kind: "assistant" })],
      ["an ID that names no chat", notice(text, { id: "supervisor-watch:only-one-part" })],
      ["no quote", notice(sentence)],
      ["an empty quote", notice(`${sentence}\n\n> `)],
      ["text after the quote", notice(`${text}\n\nOpen that chat to respond.`)],
    ])("%s", (_, item) => expect(answeredNotice(item)).toBeNull());
  });
});

describe("answeredSummary", () => {
  const approval = notice(`${sentence}\n\n> pnpm test`);
  const question = notice(`Game QA is no longer waiting for that input.\n\n> Which color?`);
  const unknown = notice(`Game QA has moved on.\n\n> pnpm test`);
  it.each([
    [[approval, approval, approval], "3 approvals answered"],
    [[question, question], "2 questions answered"],
    [[approval, question], "2 requests answered"],
    [[approval, unknown], "2 requests answered"],
    [[unknown, unknown], "2 requests answered"],
  ])("%#: %s", (items, summary) => expect(answeredSummary(items)).toBe(summary));
});

describe("answeredRuns", () => {
  const answered = (n: number, chat = CHAT) =>
    notice(`${sentence}\n\n> echo ${n}`, {
      id: `supervisor-watch:${SUPERVISOR}:${chat}:input:turn-${n}:approval-${n}`,
    });
  const other = (id: string) => notice("Agent’s reply", { id, title: "Agent result" });
  const known = (id: string) => id === CHAT;

  it("folds two or more answered notices in a row under the first one's id", () => {
    const view = [other("a"), answered(1), answered(2), answered(3), other("b")];
    const rows = answeredRuns(view, known);
    expect(rows.map((row) => row.id)).toEqual(["a", view[1]!.id, "b"]);
    expect(rows[1]!.answered?.map((row) => row.id)).toEqual(view.slice(1, 4).map((r) => r.id));
  });

  it("leaves a single answered notice as its own row", () => {
    const view = [answered(1), other("a"), answered(2)];
    expect(answeredRuns(view, known)).toEqual(view);
  });

  it("ends a run at a notice whose chat it cannot name, which stays as written", () => {
    const stranger = answered(9, "33333333-3333-4333-8333-333333333333");
    const view = [answered(1), answered(2), stranger, answered(3)];
    const rows = answeredRuns(view, known);
    expect(rows.map((row) => row.answered?.length ?? 0)).toEqual([2, 0, 0]);
    expect(rows[1]).toBe(stranger);
  });

  it("does not fold a pending request's notice", () => {
    const pending = notice(`${sentence}\n\n> pnpm test\n\nAnswer it here or in that chat.`, {
      title: "Agent needs your input",
    });
    expect(answeredRuns([answered(1), pending, answered(2)], known)).toHaveLength(3);
  });
});

/**
 * The daemon's own watcher, given just enough of a store to post its notices: the client must
 * still read what it writes when a watched chat's approval is answered. It is loaded by path at
 * run time, since type-checking the daemon's sources belongs to the daemon's own settings.
 */
describe("the daemon's answered-approval notice", () => {
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

  const approval = (summary: string, detail: string): AgentPending => ({
    id: "approval-1",
    turnId: "turn-1",
    kind: "approval",
    title: "Allow?",
    summary,
    detail,
    decisions: ["accept", "decline", "cancel"],
    questions: [],
  });

  async function answered(pending: AgentPending, after: object = {}) {
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
    let target = agent(CHAT, { status: "needs_input", pending: [pending] });
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
    return [...items.values()].find((item) => item.title === ANSWERED_TITLE);
  }

  it("is read as an answered command", async () => {
    const item = await answered(approval("pnpm test", "{}"));
    expect(item).toBeDefined();
    expect(answeredNotice(item!)).toEqual({
      sessionId: CHAT,
      kind: "approval",
      action: "pnpm test",
      command: true,
    });
    // Folded with another, it still names its chat.
    expect(answeredRuns<Row>([item!, item!], (id) => id === CHAT)[0]?.answered).toHaveLength(2);
  });

  it("is read as an answered file request", async () => {
    const input = JSON.stringify({ file_path: "/w/src/index.html", content: "<p>hi</p>" });
    const detail = JSON.stringify({ command: input, reason: "Write" });
    const item = await answered(approval(`${input}\nWrite`, detail));
    expect(answeredNotice(item!)).toEqual({
      sessionId: CHAT,
      kind: "approval",
      action: "Write index.html",
      command: false,
    });
  });

  it("is read as an approval whether or not the chat carried on", async () => {
    const item = await answered(approval("pnpm test", "{}"), { status: "done" });
    expect(answeredNotice(item!)?.kind).toBe("approval");
  });

  it("is read as an answered question", async () => {
    const question: AgentPending = {
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
    for (const after of [{}, { status: "done" }]) {
      const item = await answered(question, after);
      expect(answeredNotice(item!)).toEqual({
        sessionId: CHAT,
        kind: "question",
        action: "Which color?",
        command: false,
      });
      expect(answeredSummary([item!, item!])).toBe("2 questions answered");
    }
  });

  it("keeps a long command whole", async () => {
    const command = `cd "/tmp/star-catcher" && for i in $(seq 1 60); do echo $i; done\necho done`;
    const item = await answered(approval(JSON.stringify({ command }), "{}"));
    expect(answeredNotice(item!)?.action).toBe(command);
  });
});
