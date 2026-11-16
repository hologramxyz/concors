import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { projectPanes, resolveMobileSelection, tabPanes } from "./selection";
const workspace: WorkspaceSnapshot = {
  schemaVersion: 1,
  machineId: "machine",
  epoch: "epoch",
  revision: 1,
  selection: { projectId: "p", tabId: "t" },
  projects: [
    {
      id: "p",
      name: "Project",
      directory: "/repo",
      version: 1,
      tabs: [
        {
          id: "t",
          name: "Tab",
          root: "s",
          nodes: [
            { id: "b", kind: "pane", profile: "shell", sessionId: "terminal" },
            { id: "s", kind: "split", axis: "horizontal", ratio: 0.3, first: "a", second: "b" },
            { id: "a", kind: "pane", profile: "chat", sessionId: "agent" },
          ],
        },
      ],
    },
  ],
};
describe("mobile pane navigation", () => {
  it("flattens all desktop tabs and nested splits in display order without changing IDs or layout", () => {
    const snapshot = structuredClone(workspace);
    const project = snapshot.projects[0];
    const tab = project?.tabs[0];
    if (!project || !tab) throw new Error("Missing fixture");
    tab.nodes.push(
      { id: "nested", kind: "split", axis: "vertical", ratio: 0.6, first: "b", second: "c" },
      { id: "c", kind: "pane", profile: "shell", sessionId: "another-terminal" },
    );
    const root = tab.nodes.find((node) => node.id === "s");
    if (root?.kind !== "split") throw new Error("Missing split");
    root.second = "nested";
    project.tabs.push({
      id: "other",
      name: "Notes",
      root: "d",
      nodes: [{ id: "d", kind: "pane", profile: "chat", sessionId: null }],
    });
    const before = structuredClone(snapshot);
    expect(
      projectPanes(project).map(({ tab, pane, label, profileLabel }) => [
        tab.id,
        pane.id,
        label,
        profileLabel,
      ]),
    ).toEqual([
      ["t", "a", "Tab 1", "Agent"],
      ["t", "b", "Tab 2", "Terminal"],
      ["t", "c", "Tab 3", "Terminal"],
      ["other", "d", "Notes", "Agent"],
    ]);
    expect(snapshot).toEqual(before);
    expect(projectPanes({ ...project, tabs: [] })).toEqual([]);
  });
  it("labels each pane of a split tab by its chat, as desktop titles panes", () => {
    const project = structuredClone(workspace.projects[0]);
    if (!project) throw new Error("Missing fixture");
    project.tabs = [
      {
        id: "main",
        name: "Main",
        root: "s1",
        nodes: [
          { id: "p1", kind: "pane", profile: "chat", sessionId: "fix" },
          { id: "s1", kind: "split", axis: "horizontal", ratio: 0.5, first: "p1", second: "s2" },
          { id: "p2", kind: "pane", profile: "chat", sessionId: "fresh" },
          { id: "s2", kind: "split", axis: "vertical", ratio: 0.5, first: "p2", second: "s3" },
          { id: "p3", kind: "pane", profile: "chat", sessionId: "named", name: "Release" },
          { id: "s3", kind: "split", axis: "vertical", ratio: 0.5, first: "p3", second: "p4" },
          { id: "p4", kind: "pane", profile: "shell", sessionId: "server" },
        ],
      },
      {
        id: "solo",
        name: "Tab 2",
        root: "only",
        nodes: [{ id: "only", kind: "pane", profile: "chat", sessionId: "solo-chat" }],
      },
    ];
    const agents = [
      { id: "fix", name: "Fix the checkout flow" },
      { id: "fresh", name: "New chat" },
      { id: "named", name: "Ship 0.18" },
      { id: "solo-chat", name: "Write release notes" },
    ];
    const terminals = [{ id: "server", status: "running" as const, foregroundCommand: "pnpm dev" }];
    expect(projectPanes(project, agents, terminals).map(({ label }) => label)).toEqual([
      "Fix the checkout flow",
      // A chat nobody wrote in yet has nothing to tell it apart: the tab's name and position.
      "Main 2",
      // A pane's own name wins, as on desktop.
      "Release",
      "pnpm dev",
      // An unnamed tab with one pane reads as desktop's tab strip reads it.
      "Write release notes",
    ]);
    // An idle terminal is only "Terminal", so it keeps the numbered name too.
    expect(projectPanes(project, agents, [])[3]?.label).toBe("Main 4");
    // So does a chat titled like its tab: it tells the panes apart no better.
    expect(
      projectPanes(project, [{ id: "fix", name: "Main" }, ...agents.slice(1)], terminals)[0]?.label,
    ).toBe("Main 1");
  });
  it("traverses the saved tree in display order without mutating selection or geometry", () => {
    const before = structuredClone(workspace);
    const tab = workspace.projects[0]?.tabs[0];
    if (!tab) throw new Error("Missing fixture");
    expect(tabPanes(tab).map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(
      resolveMobileSelection(workspace, { projectId: "p", tabId: "t", paneId: "b" })?.pane?.id,
    ).toBe("b");
    expect(workspace).toEqual(before);
  });
  it("opens linked agent/terminal sessions and fails closed for stale or mismatched links", () => {
    expect(resolveMobileSelection(workspace, { sessionId: "terminal" })?.pane?.id).toBe("b");
    expect(resolveMobileSelection(workspace, { sessionId: "missing" })).toBeNull();
    expect(
      resolveMobileSelection(workspace, { projectId: "other", sessionId: "agent" }),
    ).toBeNull();
  });
  it("falls back to another surviving pane when a pane closes", () => {
    expect(resolveMobileSelection(workspace, { paneId: "closed" })?.pane?.id).toBe("a");
  });
});
