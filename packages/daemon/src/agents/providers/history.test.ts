import { expect, it } from "vitest";
import { claudeHistory, piHistory, openCodeHistory } from "./history.ts";

it("keeps Claude prompt identities and native assistant/tool IDs during replay", () => {
  const messages = [
    { type: "user", uuid: "setting", message: { content: "<command-name>/model</command-name>" } },
    {
      type: "user",
      uuid: "setting-result",
      message: { content: "<local-command-stdout>Model changed</local-command-stdout>" },
    },
    { type: "user", uuid: "turn-1", message: { content: "Read this" } },
    {
      type: "assistant",
      uuid: "outer",
      message: {
        id: "reply-1",
        content: [
          { type: "text", text: "Reading" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "README.md" } },
        ],
      },
    },
    {
      type: "user",
      uuid: "result-1",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Docs" }] },
    },
  ];
  const turns = claudeHistory(messages);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.id).toBe("turn-1");
  expect(turns[0]?.items.map((i) => i["id"])).toEqual([
    "user:turn-1",
    "reply-1",
    "tool-1",
    "tool-1",
  ]);
  expect(turns[0]?.items.at(-1)).toMatchObject({
    type: "fileRead",
    output: "Docs",
    status: "completed",
  });
});
it("uses native Pi timestamps and preserves repeated prompts as separate turns", () => {
  const turns = piHistory([
    { role: "user", timestamp: 100, content: "Continue" },
    { role: "assistant", timestamp: 101, content: [{ type: "text", text: "First" }] },
    { role: "user", timestamp: 200, content: "Continue" },
    { role: "assistant", timestamp: 201, content: [{ type: "text", text: "Second" }] },
  ]);
  expect(turns.map((t) => t.id)).toEqual(["message:100", "message:200"]);
  expect(turns[1]?.items.at(-1)).toMatchObject({ id: "message:201", text: "Second" });
});
it("groups OpenCode replies by parent and excludes model-authored compaction summaries", () => {
  const turns = openCodeHistory([
    {
      info: { id: "msg-user", role: "user" },
      parts: [{ id: "p-user", type: "text", text: "Test" }],
    },
    {
      info: { id: "msg-assistant", parentID: "msg-user", role: "assistant" },
      parts: [{ id: "p-reply", type: "text", text: "Done" }],
    },
    {
      info: { id: "summary", parentID: "msg-user", role: "assistant", summary: true },
      parts: [{ id: "internal", type: "text", text: "Internal summary" }],
    },
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.items.map((i) => i["id"])).toEqual(["user:msg-user", "p-reply"]);
});
it("replays the turn a background task started without showing its notification as a prompt", () => {
  const turns = claudeHistory([
    { type: "user", uuid: "prompt", message: { content: "Run the checks in the background" } },
    {
      type: "assistant",
      uuid: "a",
      message: { id: "waiting", content: [{ type: "text", text: "Waiting" }] },
    },
    {
      type: "user",
      uuid: "notification",
      message: { content: "<task-notification>\n<task-id>b1</task-id>\n</task-notification>" },
    },
    {
      type: "assistant",
      uuid: "b",
      message: { id: "passed", content: [{ type: "text", text: "Passed" }] },
    },
  ]);
  expect(turns.map((t) => [t.id, t.items.map((i) => i["id"])])).toEqual([
    ["prompt", ["user:prompt", "waiting"]],
    ["notification", ["passed"]],
  ]);
});
it("does not show the notification Claude Code records on resume for a cut-off command", () => {
  // getSessionMessages returns the entry without the transcript's origin field.
  const turns = claudeHistory([
    {
      type: "user",
      uuid: "orphan",
      message: {
        role: "user",
        content:
          "<task-notification>\n<task-id>b1</task-id>\n<status>stopped</status>\n<summary>Background shell command didn't finish before the previous session ended</summary>\n</task-notification>",
      },
    },
    { type: "user", uuid: "prompt", message: { role: "user", content: "done" } },
    {
      type: "assistant",
      uuid: "a",
      message: { id: "reply", content: [{ type: "text", text: "Checking" }] },
    },
  ]);
  expect(turns.flatMap((t) => t.items.map((i) => i["id"]))).toEqual(["user:prompt", "reply"]);
});
