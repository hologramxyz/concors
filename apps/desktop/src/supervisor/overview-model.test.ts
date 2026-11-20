import { expect, it } from "vitest";
import type {
  AgentInfo,
  AgentPending,
  SupervisorBrief,
  SupervisorDelivery,
} from "@concors/protocol";
import { DONE_LIMIT, overviewRows } from "./overview-model";

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

it("keeps only the most recent finished sessions", () => {
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
    { action: "Approve", text: "Edit src/index.html" },
    { action: "Approve", text: "pnpm test", code: true },
  ]);
});
