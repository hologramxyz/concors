import { expect, it } from "vitest";
import type { TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";
import {
  backgroundTerminals,
  closingNames,
  closingTerminals,
  isIdleShell,
  terminalActivity,
} from "./background-terminals";

const terminal = (id: string, patch: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id,
  projectId: "p",
  profile: "shell",
  directory: "/repos/studio",
  status: "running",
  exitCode: null,
  error: null,
  startedAt: "2026-10-28T00:00:00Z",
  cols: 80,
  rows: 24,
  foregroundCommand: null,
  ...patch,
});
const workspace: Pick<WorkspaceSnapshot, "projects"> = {
  projects: [
    {
      id: "p",
      name: "studio",
      directory: "/repos/studio",
      version: 1,
      tabs: [
        {
          id: "t",
          name: "Tab 1",
          root: "s",
          nodes: [
            { kind: "split", id: "s", axis: "horizontal", ratio: 0.5, first: "a", second: "b" },
            { kind: "pane", id: "a", profile: "shell", sessionId: "open" },
            { kind: "pane", id: "b", profile: "claude", sessionId: "cli" },
          ],
        },
      ],
    },
  ],
};

it("says what a terminal is busy with, by agent name or labelled command", () => {
  expect(terminalActivity(terminal("a"))).toBeNull();
  expect(terminalActivity(terminal("a", { foregroundCommand: "npm run dev" }))).toBe("npm run dev");
  expect(terminalActivity(terminal("a", { profile: "claude" }))).toBe("Claude Code");
  expect(terminalActivity(terminal("a", { detectedAgent: "codex" }))).toBe("Codex");
  expect(terminalActivity(terminal("a", { status: "exited", profile: "claude" }))).toBeNull();
  // Only a daemon that reports foreground jobs can say a shell is idle.
  expect(isIdleShell(terminal("a"))).toBe(true);
  expect(isIdleShell(terminal("a", { foregroundCommand: undefined }))).toBe(false);
  expect(isIdleShell(terminal("a", { foregroundCommand: "make" }))).toBe(false);
});

it("lists closed terminals still running something, newest first, and drops the rest", () => {
  const terminals = [
    terminal("open", { foregroundCommand: "vite" }),
    terminal("idle"),
    terminal("dev", { foregroundCommand: "npm run dev" }),
    terminal("agent", { profile: "codex", startedAt: "2026-10-28T01:00:00Z" }),
    terminal("exited", { profile: "codex", status: "exited" }),
    terminal("elsewhere", { projectId: "gone", foregroundCommand: "make" }),
  ];
  expect(backgroundTerminals(workspace, terminals).map((item) => item.id)).toEqual([
    "agent",
    "dev",
  ]);
});

it("finds the running terminals a closing tab or pane takes with it", () => {
  const tab = workspace.projects[0]!.tabs[0];
  const terminals = [terminal("open"), terminal("cli", { profile: "claude" }), terminal("other")];
  expect(closingTerminals(tab, terminals).map((item) => item.id)).toEqual(["open", "cli"]);
  expect(closingTerminals(tab, terminals, "b").map((item) => item.id)).toEqual(["cli"]);
});

it("keeps the names the user gave the panes a close sends to the background", () => {
  const tab = workspace.projects[0]!.tabs[0]!;
  expect(closingNames(tab)).toEqual(new Map());
  const named = {
    ...tab,
    name: "test",
    nodes: tab.nodes.map((node) =>
      node.kind === "pane" && node.id === "b" ? { ...node, name: "reviewer" } : node,
    ),
  };
  expect(closingNames(named)).toEqual(
    new Map([
      ["open", "test"],
      ["cli", "reviewer"],
    ]),
  );
  expect(closingNames(named, "a")).toEqual(new Map([["open", "test"]]));
});
