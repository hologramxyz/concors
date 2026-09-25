import { expect, it } from "vitest";
import type { AgentInfo, WorkspaceSnapshot } from "@concors/protocol";
import { closedChats, searchClosedChats } from "./closed-chats";

const workspace: WorkspaceSnapshot = {
  schemaVersion: 1,
  machineId: "m",
  epoch: "e",
  revision: 1,
  selection: null,
  projects: [
    {
      id: "p",
      name: "Hologram",
      directory: "/repos/hologram",
      version: 1,
      tabs: [
        {
          id: "t",
          name: "Tab 1",
          root: "open",
          nodes: [{ kind: "pane", id: "open", profile: "chat", sessionId: "open" }],
        },
      ],
    },
  ],
};
const agent = (id: string, patch: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  projectId: "p",
  provider: "codex",
  providerLabel: "Codex",
  name: `Chat ${id}`,
  directory: "/repos/hologram",
  model: "gpt-5.5",
  threadId: `thread-${id}`,
  turnId: `turn-${id}`,
  status: "done",
  error: null,
  startedAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
  turnStartedAt: null,
  revision: 1,
  pending: [],
  attention: null,
  ...patch,
});

it("lists closed Codex, Claude Code and OpenCode chats newest first under their pane names", () => {
  const chats = closedChats(workspace, [
    agent("open"),
    agent("old", { updatedAt: "2026-09-18T00:00:00Z" }),
    agent("renamed", { paneName: "Hello world", updatedAt: "2026-09-21T00:00:00Z" }),
    agent("tab", { provider: "claude", tabName: "Release", updatedAt: "2026-09-19T00:00:00Z" }),
    agent("pi", { provider: "pi" }),
    agent("unsent", { turnId: null }),
    agent("gone", { projectId: "removed" }),
  ]);
  expect(chats.map((chat) => [chat.agent.id, chat.title])).toEqual([
    ["renamed", "Hello world"],
    ["tab", "Release"],
    ["old", "Chat old"],
  ]);
  expect(chats[1]).toMatchObject({ engine: "claude", projectName: "Hologram" });
});

it("lists a pane's provider switches once, as its latest conversation, and not while one is open", () => {
  const group = [
    agent("first", { providerGroupId: "first", paneName: "Refactor" }),
    agent("second", {
      provider: "claude",
      providerGroupId: "first",
      updatedAt: "2026-09-22T00:00:00Z",
    }),
  ];
  expect(closedChats(workspace, group).map((chat) => [chat.agent.id, chat.title])).toEqual([
    ["second", "Refactor"],
  ]);
  const shown = [...group, agent("open", { providerGroupId: "first" })];
  expect(closedChats(workspace, shown)).toEqual([]);
});

it("finds chats by name, first message, agent, model and workspace", () => {
  const chats = closedChats(workspace, [
    agent("a", { paneName: "Hello world", name: "Fix the login redirect" }),
    agent("b", { provider: "opencode", providerLabel: "OpenCode", model: "kimi-k2" }),
  ]);
  const ids = (query: string) => searchClosedChats(chats, query).map((chat) => chat.agent.id);
  expect(ids("hello")).toEqual(["a"]);
  expect(ids("login redirect")).toEqual(["a"]);
  expect(ids("opencode")).toEqual(["b"]);
  expect(ids("kimi")).toEqual(["b"]);
  expect(ids("hologram")).toEqual(["a", "b"]);
  expect(ids("missing")).toEqual([]);
});
