import { expect, it } from "vitest";
import type { WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { tabTitle } from "./tab-title";
import { clashingWorkspaceParents } from "./workspace-parents";

const pane = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "pane" as const,
  profile: "shell" as const,
  sessionId: null,
  ...extra,
});
const tab = (name: string, nodes: WorkspaceTab["nodes"], root = nodes[0]!.id) =>
  ({ id: "tab", name, root, nodes }) as WorkspaceTab;

it("names an unnamed tab after its main pane, and keeps a name someone chose", () => {
  const agents = [{ id: "chat", name: "hello?" }];
  expect(tabTitle(tab("Tab 1", [pane("a")]), agents)).toBe("Terminal");
  expect(tabTitle(tab("Tab 1", [pane("a", { profile: "chat" })]), agents)).toBe("New chat");
  expect(tabTitle(tab("Tab 2", [pane("a", { profile: "chat", sessionId: "chat" })]), agents)).toBe(
    "hello?",
  );
  expect(tabTitle(tab("Tab 1", [pane("a", { name: "Build" })]), agents)).toBe("Build");
  expect(tabTitle(tab("Research", [pane("a")]), agents)).toBe("Research");
});
it("names a split tab after the first pane in its layout", () => {
  const split = {
    id: "s",
    kind: "split" as const,
    axis: "horizontal" as const,
    ratio: 0.5,
    first: "b",
    second: "a",
  };
  const nodes = [
    split,
    pane("a"),
    pane("b", { profile: "claude", terminalProfile: { name: "Claude Code" } }),
  ] as WorkspaceTab["nodes"];
  expect(tabTitle(tab("Tab 1", nodes, "s"), [])).toBe("Claude Code");
});
it("shows a parent folder only for workspaces in different folders with the same name", () => {
  const project = (id: string, name: string, directory: string) =>
    ({ id, name, directory }) as WorkspaceProject;
  const parents = clashingWorkspaceParents([
    project("1", "studio", "/Users/me/work/studio"),
    project("2", "studio", "/Users/me/old/studio"),
    project("3", "Workspace 1", "/Users/me"),
    project("4", "app", "/Users/me/app"),
    project("5", "app", "/Users/me/app"),
  ]);
  expect([...parents]).toEqual([
    ["1", "work"],
    ["2", "old"],
  ]);
});
