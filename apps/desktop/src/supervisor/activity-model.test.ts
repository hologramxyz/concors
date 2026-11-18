import { expect, it } from "vitest";
import type { AgentInfo, AgentPending, SupervisorDelivery } from "@concors/protocol";
import { DONE_LIMIT, activityRows } from "./activity-model";

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

it("lists each agent once, under what it needs from you, with one line of detail", () => {
  const qa = agent("Game QA", { status: "needs_input", pending: [approval], queue: [] });
  const hud = agent("HUD polish", {
    status: "working",
    turnId: "turn-2",
    queue: [{ id: id(), text: "Check touch targets", attachments: [] }] as AgentInfo["queue"],
  });
  const notes = agent("Release editor", { status: "done" });
  const idle = agent("Scratch");
  const rows = activityRows(
    [qa, hud, notes, idle],
    [
      delivered(hud, "Check touch targets", "queued"),
      delivered(hud, "Review the HUD", "working"),
      delivered(notes, "Check the release notes\nThen summarize", "done"),
    ],
  );
  expect(rows.map((row) => [row.agent.name, row.group, row.detail])).toEqual([
    ["Game QA", "Needs you", "pnpm test"],
    ["HUD polish", "Working", "Check touch targets · 1 queued"],
    ["Release editor", "Done", "Check the release notes"],
  ]);
});

it("shows failures as needing you until seen, then as stopped work under Done", () => {
  const failed = agent("Build", { status: "failed", error: "Tests failed\nstack" });
  expect(activityRows([failed], [])[0]).toMatchObject({
    group: "Needs you",
    detail: "Tests failed",
  });
  const stopped = agent("Docs", { status: "interrupted" });
  expect(
    activityRows([stopped], [delivered(stopped, "Write docs", "interrupted")])[0],
  ).toMatchObject({ group: "Done", detail: "Stopped · Write docs" });
});

it("keeps only the most recent finished agents", () => {
  const finished = Array.from({ length: DONE_LIMIT + 3 }, (_, index) =>
    agent(`Agent ${index}`, {
      updatedAt: `2026-11-18T10:${String(index).padStart(2, "0")}:00.000Z`,
    }),
  );
  const rows = activityRows(
    finished,
    finished.map((item) => delivered(item, "Task", "done")),
  );
  expect(rows).toHaveLength(DONE_LIMIT);
  expect(rows[0]?.agent.name).toBe(`Agent ${DONE_LIMIT + 2}`);
});
