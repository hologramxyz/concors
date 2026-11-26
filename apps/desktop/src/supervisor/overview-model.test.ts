import { describe, expect, it } from "vitest";
import type {
  AgentInfo,
  AgentPending,
  SupervisorBrief,
  SupervisorDelivery,
} from "@concors/protocol";
import {
  DONE_LIMIT,
  DONE_SHOWN,
  doneInView,
  needsYou,
  overviewRows,
  unseenDone,
  workspaceAgents,
} from "./overview-model";
import { markFailureSeen } from "@/agents/seen-updates";

let next = 0;
const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
const agent = (name: string, patch: Partial<AgentInfo> = {}) =>
  ({
    id: id(),
    projectId: "00000000-0000-4000-8000-0000000000aa",
    name,
    provider: "codex",
    status: "idle",
    pending: [],
    attention: null,
    error: null,
    turnId: null,
    updatedAt: "2026-11-18T10:00:00.000Z",
    ...patch,
  }) as AgentInfo;
const delivered = (target: AgentInfo, text: string, status: SupervisorDelivery["status"]) =>
  ({
    id: id(),
    supervisorId: id(),
    sessionId: target.id,
    projectId: target.projectId,
    text,
    status,
    createdAt: "2026-11-18T09:00:00.000Z",
    updatedAt: "2026-11-18T09:00:00.000Z",
  }) satisfies SupervisorDelivery;
const brief = (target: AgentInfo, reply: string, prompt = ""): [string, SupervisorBrief] => [
  target.id,
  { sessionId: target.id, turnId: target.turnId, prompt, reply },
];
const approval = {
  id: id(),
  turnId: "turn-1",
  kind: "approval",
  title: "Allow command execution?",
  summary: "pnpm test",
  detail: "{}",
  decisions: ["accept", "decline"],
  questions: [],
} satisfies AgentPending;

it("lists each session once, under what it needs, with what it needs said in full", () => {
  const qa = agent("Game QA", {
    status: "needs_input",
    turnId: "turn-1",
    pending: [approval],
    queue: [],
  });
  const hud = agent("HUD polish", {
    status: "working",
    turnId: "turn-2",
    queue: [
      {
        id: id(),
        text: "Check touch targets",
        attachments: [],
        queuedAt: "2026-11-18T10:00:00.000Z",
      },
    ],
  });
  const notes = agent("Release editor", { status: "done", turnId: "turn-3" });
  const idle = agent("Scratch");
  const rows = overviewRows(
    [qa, hud, notes, idle],
    [
      delivered(hud, "Check touch targets", "queued"),
      delivered(hud, "Review the HUD", "working"),
      delivered(notes, "Check the release notes\nThen summarize", "done"),
    ],
    new Set(),
    new Map([
      brief(qa, "On it: reading base.css, then running the tests."),
      brief(hud, "I compared both layouts. The left rail clips at 320 px."),
      brief(notes, "**TL;DR:** Two typos fixed, the date corrected."),
    ]),
  );
  expect(
    rows.map((row) => [row.agent.name, row.group, row.needs, row.update, row.task, row.queued]),
  ).toEqual([
    [
      "Game QA",
      "Needs you",
      { action: "Approve", text: "pnpm test", code: true },
      "On it: reading base.css, then running the tests.",
      "",
      0,
    ],
    [
      "HUD polish",
      "In progress",
      null,
      "I compared both layouts. The left rail clips at 320 px.",
      "Review the HUD",
      1,
    ],
    [
      "Release editor",
      "Done",
      null,
      "Two typos fixed, the date corrected.",
      "Check the release notes",
      0,
    ],
  ]);
});

it("says what a failure was until it is seen, then lists it under Done", () => {
  const failed = agent("Build", { status: "failed", error: "Tests failed\nstack" });
  expect(overviewRows([failed], [])[0]).toMatchObject({
    group: "Needs you",
    needs: { action: "Failed", text: "Tests failed" },
  });
  const stopped = agent("Docs", { status: "interrupted" });
  expect(
    overviewRows([stopped], [delivered(stopped, "Write docs", "interrupted")])[0],
  ).toMatchObject({ group: "Done", task: "Write docs" });
});

describe("a paused queue with instructions waiting", () => {
  const waiting = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: id(),
      text: `Step ${i}`,
      attachments: [],
      queuedAt: "2026-11-18T10:00:00.000Z",
    }));
  const paused = (patch: Partial<AgentInfo> = {}) =>
    agent("Game QA", {
      status: "idle",
      turnId: "turn-1",
      queuePaused: true,
      queue: waiting(2),
      ...patch,
    });

  it("needs you, saying how many instructions wait, and counts on the Overview button", () => {
    const qa = paused();
    expect(overviewRows([qa], [delivered(qa, "Run QA", "done")])[0]).toMatchObject({
      group: "Needs you",
      needs: { action: "Queue paused", text: "2 instructions waiting" },
      queued: 2,
    });
    expect(needsYou(qa)).toBe(true);
  });

  it("needs you while the chat still works, rather than sitting under In progress", () => {
    const qa = paused({ status: "working" });
    expect(overviewRows([qa], [])[0]?.group).toBe("Needs you");
  });

  it("shows an open request instead, in one row", () => {
    const qa = paused({ status: "needs_input", pending: [approval] });
    const rows = overviewRows([qa], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      group: "Needs you",
      needs: { action: "Approve", text: "pnpm test" },
    });
    expect(needsYou(qa)).toBe(true);
  });

  it("names the paused queue once its chat's failure is seen", () => {
    const qa = paused({
      status: "failed",
      error: "Provider exited",
      updatedAt: "2026-11-18T11:00:00.000Z",
    });
    expect(overviewRows([qa], [])[0]?.needs?.action).toBe("Failed");
    markFailureSeen(qa);
    expect(overviewRows([qa], [])[0]).toMatchObject({
      group: "Needs you",
      needs: { action: "Queue paused", text: "2 instructions waiting" },
    });
  });

  it.each([
    ["resumed", { queuePaused: false }, "In progress"],
    ["emptied", { queue: [] }, "Done"],
    ["resumed while working", { queuePaused: false, status: "working" as const }, "In progress"],
  ])("goes back where it belongs once %s", (_, patch, group) => {
    const qa = paused(patch);
    expect(overviewRows([qa], [delivered(qa, "Run QA", "done")])[0]?.group).toBe(group);
    expect(needsYou(qa)).toBe(false);
  });

  it("leaves the Supervisor itself out of the count", () => {
    expect(needsYou(paused({ supervisor: true } as Partial<AgentInfo>))).toBe(false);
  });
});

it("lists open sessions that replied, with the prompt of a session nobody delegated", () => {
  const open = agent("Docs", { status: "done", turnId: "turn-9" });
  const fresh = agent("Empty", { turnId: null });
  const hidden = agent("Closed", { status: "done", turnId: "turn-3" });
  const working = agent("Builder", { status: "working", turnId: "turn-4" });
  const rows = overviewRows(
    [open, fresh, hidden, working],
    [],
    new Set([open.id, fresh.id, working.id]),
    new Map([
      brief(open, "## Summary\n- Rewrote the **README** intro"),
      brief(working, "", "Port the build to Vite\nwith details"),
    ]),
  );
  expect(rows.map((row) => [row.agent.name, row.group, row.task, row.update])).toEqual([
    ["Docs", "Done", "", "Rewrote the README intro"],
    ["Builder", "In progress", "Port the build to Vite", ""],
  ]);
  // A brief of an earlier turn says nothing about the current one.
  const stale = new Map([
    [open.id, { sessionId: open.id, turnId: "turn-8", prompt: "", reply: "Old" }],
  ]);
  expect(overviewRows([open], [], new Set([open.id]), stale)[0]?.update).toBe("");
});

it("keeps only the most recent finished sessions, and every one not yet opened", () => {
  const finished = Array.from({ length: DONE_LIMIT + 3 }, (_, index) =>
    agent(`Agent ${index}`, {
      updatedAt: `2026-11-18T10:${String(index).padStart(2, "0")}:00.000Z`,
    }),
  );
  const rows = overviewRows(
    finished,
    finished.map((item) => delivered(item, "Task", "done")),
  );
  expect(rows).toHaveLength(DONE_LIMIT);
  expect(rows[0]?.agent.name).toBe(`Agent ${DONE_LIMIT + 2}`);
  const unread = agent("Unread", {
    status: "done",
    updatedAt: "2026-11-01T10:00:00.000Z",
    attention: { id: "a", kind: "done", seen: false, createdAt: "2026-11-01T10:00:00.000Z" },
  });
  const withUnread = overviewRows(
    [...finished, unread],
    finished.map((item) => delivered(item, "Task", "done")),
  );
  expect(withUnread).toHaveLength(DONE_LIMIT + 1);
  expect(withUnread.at(-1)?.agent.name).toBe("Unread");
});

describe("Done in view", () => {
  // Nine finishes, newest first as overviewRows orders them; two of the older ones never opened.
  const unseen = (at: string) => ({
    status: "done" as const,
    attention: { id: id(), kind: "done" as const, seen: false, createdAt: at },
  });
  const finished = Array.from({ length: 9 }, (_, index) => {
    const at = `2026-11-18T10:${String(index).padStart(2, "0")}:00.000Z`;
    return agent(`Agent ${index}`, { updatedAt: at, ...(index < 2 ? unseen(at) : {}) });
  });
  const rows = overviewRows(
    finished,
    finished.map((item) => delivered(item, "Task", "done")),
  );
  const names = (list: readonly { agent: AgentInfo }[]) => list.map((row) => row.agent.name);

  it("shows the five most recent, in order, and every finish not yet opened", () => {
    expect(rows.every((row) => row.group === "Done")).toBe(true);
    const { shown, hidden } = doneInView(rows, false);
    expect(DONE_SHOWN).toBe(5);
    expect(names(shown)).toEqual([
      "Agent 8",
      "Agent 7",
      "Agent 6",
      "Agent 5",
      "Agent 4",
      "Agent 1",
      "Agent 0",
    ]);
    expect(shown.filter(unseenDone).map((row) => row.agent.name)).toEqual(["Agent 1", "Agent 0"]);
    expect(hidden).toBe(2);
  });

  it("shows every row once expanded, and folds back to the same rows", () => {
    expect(doneInView(rows, true)).toEqual({ shown: rows, hidden: 0 });
    expect(names(doneInView(rows, false).shown)).toHaveLength(7);
  });

  it("hides nothing when there are five or fewer", () => {
    expect(doneInView(rows.slice(0, 5), false)).toEqual({ shown: rows.slice(0, 5), hidden: 0 });
    expect(doneInView([], false)).toEqual({ shown: [], hidden: 0 });
  });
});

it("names a file approval by its verb and the file inside the workspace, a command as code", () => {
  const edit = agent("Footer", {
    status: "needs_input",
    directory: "/work/shop",
    pending: [
      { ...approval, summary: '{"file_path":"/work/shop/src/index.html"}\nEdit\nFolder: /work' },
    ],
  });
  const run = agent("Tests", {
    status: "needs_input",
    directory: "/work/shop",
    pending: [approval],
  });
  expect(overviewRows([edit, run], []).map((row) => row.needs)).toEqual([
    // The tool and its file apart, with no separator: the row writes the path from its folder.
    { action: "Approve", verb: "Edit", text: "/work/shop/src/index.html", path: true },
    { action: "Approve", text: "pnpm test", code: true },
  ]);
  const fetch = agent("Docs", {
    status: "needs_input",
    pending: [{ ...approval, summary: '{"url":"https://example.com"}\nWebFetch' }],
  });
  expect(overviewRows([fetch], [])[0]?.needs).toEqual({
    action: "Approve",
    verb: "WebFetch",
    text: "https://example.com",
  });
});

it("says what the current turn was asked, not an instruction from an earlier one", () => {
  const docs = agent("Docs", { status: "done", turnId: "turn-2" });
  const sent = [delivered(docs, "Write the changelog", "done")];
  expect(overviewRows([docs], sent)[0]?.task).toBe("Write the changelog");
  expect(
    overviewRows(
      [docs],
      sent,
      new Set(),
      new Map([brief(docs, "Done.", "Fix the typo in README")]),
    )[0]?.task,
  ).toBe("Fix the typo in README");
});

it("counts only sessions in the machine's workspaces", () => {
  const mine = agent("Mine");
  const stray = agent("Stray", { projectId: "00000000-0000-4000-8000-0000000000bb" });
  const workspace = {
    projects: [{ id: mine.projectId }],
    closedProjects: [],
  } as unknown as Parameters<typeof workspaceAgents>[1];
  expect(workspaceAgents([mine, stray], workspace)).toEqual([mine]);
  expect(workspaceAgents([mine], null)).toEqual([]);
});

it("folds seen finishes from before the last day under Earlier, never news or work", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  const today = agent("Today", { turnId: "t1", updatedAt: "2026-11-20T09:00:00.000Z" });
  const old = agent("Old", { turnId: "t2", updatedAt: "2026-11-03T09:00:00.000Z" });
  const unread = agent("Unread", {
    status: "done",
    turnId: "t3",
    updatedAt: "2026-11-03T09:00:00.000Z",
    attention: { id: "a", kind: "done", seen: false, createdAt: "2026-11-03T09:00:00.000Z" },
  });
  const blocked = agent("Blocked", {
    status: "needs_input",
    turnId: "t4",
    pending: [approval],
    updatedAt: "2026-11-03T09:00:00.000Z",
  });
  const rows = overviewRows(
    [today, old, unread, blocked],
    [],
    new Set([today.id, old.id, unread.id, blocked.id]),
    null,
    now,
  );
  expect(rows.map((row) => [row.agent.name, row.group, row.earlier])).toEqual([
    ["Today", "Done", false],
    ["Old", "Done", true],
    ["Unread", "Done", false],
    ["Blocked", "Needs you", false],
  ]);
});
