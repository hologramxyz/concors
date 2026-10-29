import { expect, it } from "vitest";
import type { AgentInfo, TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";
import { rowState, shortAge, sidebarRows, stableOrder } from "./sidebar-rows";

const workspace: Pick<WorkspaceSnapshot, "projects"> = {
  projects: [
    {
      id: "p",
      name: "studio",
      directory: "/repos/studio",
      version: 1,
      tabs: [
        {
          id: "chat-tab",
          name: "Tab 1",
          root: "chat-pane",
          nodes: [{ kind: "pane", id: "chat-pane", profile: "chat", sessionId: "open" }],
        },
        {
          id: "split-tab",
          name: "Tab 2",
          root: "split",
          nodes: [
            {
              kind: "split",
              id: "split",
              axis: "horizontal",
              ratio: 0.5,
              first: "claude-pane",
              second: "shell-pane",
            },
            { kind: "pane", id: "claude-pane", profile: "claude", sessionId: "cli" },
            { kind: "pane", id: "shell-pane", profile: "shell", sessionId: "shell" },
          ],
        },
        {
          id: "shell-tab",
          name: "Tab 3",
          root: "lone-shell",
          nodes: [{ kind: "pane", id: "lone-shell", profile: "shell", sessionId: null }],
        },
      ],
    },
    { id: "empty", name: "Workspace 1", directory: "/Users/me", version: 1, tabs: [] },
  ],
};
const agent = (id: string, patch: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  projectId: "p",
  provider: "codex",
  providerLabel: "Codex",
  name: `Chat ${id}`,
  directory: "/repos/studio",
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
const terminal = (id: string, patch: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id,
  projectId: "p",
  profile: "shell",
  directory: "/repos/studio",
  status: "running",
  exitCode: null,
  error: null,
  startedAt: "2026-09-21T00:00:00Z",
  cols: 80,
  rows: 24,
  ...patch,
});

it("lists each workspace's open tabs in tab-bar order, then its closed chats newest first", () => {
  const { rows } = sidebarRows(
    workspace,
    [
      agent("open", { name: "hello?" }),
      agent("old", { updatedAt: "2026-09-18T00:00:00Z" }),
      agent("newer", { updatedAt: "2026-09-19T00:00:00Z" }),
    ],
    [
      terminal("cli", { profile: "claude", agentActivity: "idle" }),
      terminal("shell", { startedAt: "2026-09-22T00:00:00Z" }),
    ],
  );
  expect(
    rows.get("p")?.map((row) => [row.key, row.kind === "closed" ? row.chat.title : row.title]),
  ).toEqual([
    ["tab:chat-tab", "hello?"],
    // A split tab is one row, named and timed after its first pane.
    ["tab:split-tab", "Claude Code"],
    // A plain terminal is listed too, before it has even started.
    ["tab:shell-tab", "Terminal"],
    ["closed:newer", "Chat newer"],
    ["closed:old", "Chat old"],
  ]);
  const [chat, split, shell] = rows.get("p") ?? [];
  expect(chat).toMatchObject({ tool: "chat", time: "2026-09-20T00:00:00Z" });
  expect(split).toMatchObject({ tool: "claude", time: "2026-09-21T00:00:00Z" });
  // Not started yet, so timed from when the list first showed it.
  expect(Date.parse(shell!.time)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  expect(rows.get("empty")).toEqual([]);
});

it("lets a live agent elsewhere in a split speak for the row once the main pane's has stopped", () => {
  const live = (id: string) => terminal(id, { profile: "codex", agentActivity: "idle" });
  const split = (stopped: TerminalInfo) =>
    sidebarRows(workspace, [], [stopped, live("shell")]).rows.get("p")?.[1];
  // Its name still comes from the main pane; its status and click go to the agent still running.
  expect(split(terminal("cli", { profile: "claude", status: "exited" }))).toMatchObject({
    title: "Claude Code",
    terminal: { id: "shell" },
    tool: "codex",
  });
  expect(split(live("cli"))).toMatchObject({ terminal: { id: "cli" } });
});

it("keeps chats whose workspace was removed apart, once per pane, newest first", () => {
  const { rows, unavailable } = sidebarRows(
    workspace,
    [
      agent("gone", { projectId: "removed", updatedAt: "2026-09-18T00:00:00Z" }),
      agent("switched", {
        projectId: "removed",
        providerGroupId: "group",
        updatedAt: "2026-09-19T00:00:00Z",
      }),
      agent("before-switch", { projectId: "removed", providerGroupId: "group" }),
      agent("never-sent", { projectId: "removed", turnId: null }),
    ],
    [],
  );
  expect(unavailable.map((chat) => chat.id)).toEqual(["before-switch", "gone"]);
  expect([...rows.values()].flat().some((row) => row.kind === "closed")).toBe(false);
});

it("keeps rows where they were while hovered, with new rows after them", () => {
  const rows = [{ key: "c" }, { key: "a" }, { key: "new" }, { key: "b" }];
  expect(stableOrder(rows, ["a", "b", "c"]).map((row) => row.key)).toEqual(["a", "b", "c", "new"]);
  expect(stableOrder(rows, undefined)).toEqual(rows);
});

it("shows compact ages", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  expect(shortAge("2026-10-28T11:59:40Z", now)).toBe("now");
  expect(shortAge("2026-10-28T11:58:00Z", now)).toBe("2m");
  expect(shortAge("2026-10-28T09:00:00Z", now)).toBe("3h");
  expect(shortAge("2026-10-25T12:00:00Z", now)).toBe("3d");
  expect(shortAge("2026-08-20T12:00:00Z", now)).toBe("2mo");
  expect(shortAge("2024-10-28T12:00:00Z", now)).toBe("2y");
});

it("dots a row only while its agent works or needs you", () => {
  const state = (chat: AgentInfo, cli = terminal("cli", { profile: "claude" })) =>
    rowState(sidebarRows(workspace, [chat, agent("closed")], [cli]).rows.get("p")![0]!);
  expect(state(agent("open"))).toBeUndefined();
  expect(state(agent("open", { status: "working" }))).toBe("working");
  expect(state(agent("open", { backgroundAgents: 1 }))).toBe("working");
  expect(state(agent("open", { status: "needs_input" }))).toBe("attention");
  expect(
    state(
      agent("open", {
        attention: { id: "a", kind: "done", createdAt: "2026-09-20T00:00:00Z", seen: false },
      }),
    ),
  ).toBe("done");
  expect(state(agent("open", { status: "failed" }))).toBe("attention");
  const cli = (patch: Partial<TerminalInfo>) =>
    rowState(
      sidebarRows(workspace, [], [terminal("cli", { profile: "claude", ...patch })]).rows.get(
        "p",
      )![1]!,
    );
  expect(cli({ agentActivity: "working" })).toBe("working");
  expect(cli({ agentActivity: "needs_input" })).toBe("attention");
  expect(cli({ agentActivity: "idle" })).toBeUndefined();
  // A closed chat is muted, with a spinner only while it is still finishing its turn.
  const closed = (patch: Partial<AgentInfo>) =>
    rowState(sidebarRows(workspace, [agent("closed", patch)], []).rows.get("p")![3]!);
  expect(closed({ status: "needs_input" })).toBeUndefined();
  expect(closed({ status: "working" })).toBe("background");
});

it("keeps a closed terminal that still runs something among the closed rows, by when it started", () => {
  const { rows } = sidebarRows(
    workspace,
    [agent("old", { updatedAt: "2026-09-18T00:00:00Z" })],
    [
      terminal("dev", { foregroundCommand: "npm run dev", startedAt: "2026-09-19T00:00:00Z" }),
      terminal("agent", {
        profile: "codex",
        agentActivity: "working",
        startedAt: "2026-09-17T00:00:00Z",
      }),
      // A shell waiting at a prompt has nothing to come back to.
      terminal("idle", { foregroundCommand: null }),
    ],
  );
  const closed = rows.get("p")?.slice(3) ?? [];
  expect(
    closed.map((row) => [row.key, row.kind === "closed" ? row.chat.title : row.title]),
  ).toEqual([
    ["terminal:dev", "npm run dev"],
    ["closed:old", "Chat old"],
    ["terminal:agent", "Codex"],
  ]);
  expect(closed.map(rowState)).toEqual(["background", undefined, "background"]);
});

it("keeps a closed terminal's tab name and its agent's state", () => {
  const background = (patch: Partial<TerminalInfo>) =>
    sidebarRows(
      { projects: [{ ...workspace.projects[0]!, tabs: [] }] },
      [],
      [terminal("cli", { profile: "claude", ...patch })],
      new Map([["cli", "test"]]),
    ).rows.get("p")![0]!;
  const waiting = background({ agentActivity: "needs_input" });
  expect(waiting.kind === "terminal" && waiting.title).toBe("test");
  expect(rowState(waiting)).toBe("attention");
  expect(rowState(background({ agentActivity: "working" }))).toBe("background");
  expect(rowState(background({ agentActivity: "idle" }))).toBeUndefined();
});

it("dots an open shell while it runs a command", () => {
  const shellTab: Pick<WorkspaceSnapshot, "projects"> = {
    projects: [
      {
        ...workspace.projects[0]!,
        tabs: [
          {
            id: "shell-tab",
            name: "Tab 1",
            root: "pane",
            nodes: [{ kind: "pane", id: "pane", profile: "shell", sessionId: "shell" }],
          },
        ],
      },
    ],
  };
  const shell = (foregroundCommand: string | null) =>
    rowState(
      sidebarRows(shellTab, [], [terminal("shell", { foregroundCommand })]).rows.get("p")![0]!,
    );
  expect(shell("make watch")).toBe("working");
  expect(shell(null)).toBeUndefined();
});
