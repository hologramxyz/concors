import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { resolveMobileSelection, tabPanes } from "./selection";
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
