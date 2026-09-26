import { expect, it } from "vitest";
import { nativeToolItem } from "./tool-items.ts";
import { mapCodexItem } from "../codex/items.ts";

it("renders native shell, file and search tools without relabeling them as MCP", () => {
  const shell = mapCodexItem(
    nativeToolItem(
      "a",
      "Bash",
      { command: "npm test" },
      [{ type: "text", text: "Passed" }],
      true,
      false,
    ),
    true,
  );
  expect(shell).toMatchObject({
    title: "Run command",
    text: "npm test",
    detail: "Passed",
    presentation: { type: "shell" },
  });
  const edit = mapCodexItem(
    nativeToolItem(
      "b",
      "edit",
      { path: "app.ts", oldText: "before", newText: "after" },
      {},
      true,
      false,
    ),
    true,
  );
  expect(edit?.presentation).toEqual({
    type: "files",
    fileOperation: "edit",
    files: [{ path: "app.ts", diff: "-before\n+after" }],
  });
  const read = mapCodexItem(
    nativeToolItem("c", "Read", { file_path: "README.md" }, "Docs", true, false),
    true,
  );
  expect(read).toMatchObject({ title: "Read file", text: "README.md" });
  expect(nativeToolItem("d", "Grep", { pattern: "TODO" }, "result", true, false)).toMatchObject({
    type: "search",
    query: "TODO",
  });
});
it("preserves unknown tool payloads and only links child IDs actually supplied by the CLI", () => {
  expect(nativeToolItem("a", "vendor_tool", { data: 1 }, { answer: 2 }, true, true)).toMatchObject({
    type: "mcpToolCall",
    status: "failed",
    result: { answer: 2 },
  });
  expect(nativeToolItem("b", "Agent", { prompt: "Review" }, "Complete", true, false)).toMatchObject(
    { type: "collabAgentToolCall", receiverThreadIds: [] },
  );
  expect(
    nativeToolItem(
      "b",
      "task",
      {},
      { metadata: { sessionID: "child-1" }, content: "Complete" },
      true,
      false,
    ),
  ).toMatchObject({
    receiverThreadIds: ["child-1"],
    agentsStates: { "child-1": { status: "completed", message: "Complete" } },
  });
});

it("reads an OpenCode task's sub-agent steps and type from its metadata", () => {
  expect(
    nativeToolItem(
      "task",
      "task",
      { description: "Map the routes", subagent_type: "general" },
      {
        details: {
          sessionId: "child",
          summary: [
            { id: "p1", tool: "read", state: { status: "completed", title: "src/routes.ts" } },
            { id: "p2", tool: "bash", state: { status: "running", input: { command: "ls" } } },
            { id: "p3", tool: "grep", state: { status: "error", title: "router" } },
          ],
        },
      },
      false,
      false,
    ),
  ).toMatchObject({
    type: "collabAgentToolCall",
    agentType: "general",
    prompt: "Map the routes",
    receiverThreadIds: ["child"],
    activity: [
      { id: "p1", title: "read", text: "src/routes.ts", status: "completed" },
      { id: "p2", title: "bash", text: "ls", status: "running" },
      { id: "p3", title: "grep", text: "router", status: "failed" },
    ],
  });
});
