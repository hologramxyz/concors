import { expect, it } from "vitest";
import { TaskState, planSteps } from "./plans.ts";
import { claudeHistory, openCodeHistory } from "./history.ts";
import { mapCodexItem } from "../codex/items.ts";
it("preserves canonical task states, active labels, empty snapshots, and successful task mutations", () => {
  const state = new TaskState();
  expect(
    state.update(
      "TodoWrite",
      { todos: [{ content: "Inspect", status: "in_progress", activeForm: "Inspecting" }] },
      {},
      true,
    ),
  ).toEqual([{ step: "Inspect", status: "inProgress", activeForm: "Inspecting" }]);
  expect(
    state.update("TaskCreate", { subject: "Test" }, { details: { task: { id: "2" } } }, true),
  ).toHaveLength(2);
  expect(state.update("TaskUpdate", { taskId: "2", status: "completed" }, {}, false)).toBeNull();
  expect(
    state.update("TaskUpdate", { taskId: "2", status: "completed" }, {}, true, true),
  ).toBeNull();
  expect(
    state.update("TaskUpdate", { taskId: "2", status: "completed" }, {}, true)?.at(-1),
  ).toMatchObject({ step: "Test", status: "completed" });
  expect(state.update("TaskUpdate", { taskId: "2", status: "deleted" }, {}, true)).toHaveLength(1);
  expect(state.update("TodoWrite", { todos: [] }, {}, true)).toEqual([]);
  expect(
    planSteps([
      { content: "A", status: "in_progress" },
      { content: "B", status: "completed" },
    ]).map((s) => s.status),
  ).toEqual(["inProgress", "completed"]);
});
it("recovers Claude ID-based task updates and OpenCode task snapshots as plan primitives", () => {
  const turns = claudeHistory([
    { type: "user", uuid: "user", message: { content: "Plan" } },
    {
      type: "assistant",
      message: {
        id: "a",
        content: [
          { type: "tool_use", id: "create", name: "TaskCreate", input: { subject: "Verify" } },
        ],
      },
    },
    {
      type: "user",
      tool_use_result: { task: { id: "1" } },
      message: { content: [{ type: "tool_result", tool_use_id: "create", content: "Created" }] },
    },
    {
      type: "assistant",
      message: {
        id: "b",
        content: [
          {
            type: "tool_use",
            id: "update",
            name: "TaskUpdate",
            input: { taskId: "1", status: "completed" },
          },
        ],
      },
    },
    {
      type: "user",
      tool_use_result: { success: true },
      message: { content: [{ type: "tool_result", tool_use_id: "update", content: "Updated" }] },
    },
  ]);
  expect(turns[0]?.items.at(-1)).toMatchObject({
    id: "tasks:update",
    type: "plan",
    steps: [{ step: "Verify", status: "completed" }],
  });
  const code = openCodeHistory([
    { info: { id: "u", role: "user" }, parts: [] },
    {
      info: { id: "a", parentID: "u", role: "assistant" },
      parts: [
        {
          id: "todo",
          type: "tool",
          tool: "todowrite",
          state: {
            status: "completed",
            input: { todos: [{ content: "Review", status: "in_progress" }] },
          },
        },
      ],
    },
  ]);
  expect(mapCodexItem(code[0]!.items.at(-1), true)?.presentation).toMatchObject({
    type: "plan",
    steps: [{ step: "Review", status: "inProgress" }],
  });
});
it("keeps read content distinct from diffs and restores emitted thinking without signatures", () => {
  expect(
    mapCodexItem(
      { id: "read", type: "fileRead", path: "src/app.ts", output: "const value = 1;" },
      true,
    ),
  ).toMatchObject({ detail: "const value = 1;", presentation: { fileOperation: "read" } });
  const turns = claudeHistory([
    { type: "user", uuid: "u", message: { content: "Check" } },
    {
      type: "assistant",
      message: {
        id: "a",
        content: [
          {
            type: "thinking",
            thinking: "Inspecting the test results",
            signature: "not-for-display",
          },
          { type: "redacted_thinking", data: "private-opaque" },
        ],
      },
    },
  ]);
  expect(turns[0]?.items.at(-1)).toEqual({
    id: "a:thinking:0",
    type: "reasoning",
    summary: ["Inspecting the test results"],
  });
  expect(JSON.stringify(turns)).not.toContain("not-for-display");
  expect(JSON.stringify(turns)).not.toContain("private-opaque");
});
it("continues updating ID-based tasks restored from native history", () => {
  const state = new TaskState();
  state.restore([
    {
      items: [{ type: "plan", steps: [{ id: "7", step: "Verify the change", status: "pending" }] }],
    },
  ]);
  expect(state.update("TaskUpdate", { taskId: "7", status: "completed" }, {}, true)).toEqual([
    { id: "7", step: "Verify the change", status: "completed" },
  ]);
});
