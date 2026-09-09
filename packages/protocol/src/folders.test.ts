let sequence = 0;
const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
import { expect, it } from "vitest";
import { applyWorkspaceOperation } from "./workspace-reducer.ts";
import { WorkspaceSnapshotSchema, type WorkspaceOperation } from "./workspace.ts";

function fixture(follow = true) {
  let state = WorkspaceSnapshotSchema.parse({
    schemaVersion: 1,
    machineId: id(),
    epoch: id(),
    revision: 0,
    projects: [],
    selection: null,
  });
  const projectId = id(),
    tabId = id(),
    paneId = id();
  const run = (op: WorkspaceOperation) => (state = applyWorkspaceOperation(state, op));
  run({
    kind: "project.add",
    projectId,
    name: "Workspace",
    directory: "/home/dev",
    ...(follow ? { directoryMode: "follow" as const } : {}),
  });
  run({
    kind: "tab.create",
    projectId,
    expectedVersion: 0,
    tabId,
    paneId,
    name: "Terminal",
    profile: "shell",
  });
  return { run, state: () => state, projectId, tabId, paneId };
}
it("keeps existing projects pinned and anchors fresh workspaces to their original pane", () => {
  expect(fixture(false).state().projects[0]?.directoryMode).not.toBe("follow");
  const f = fixture();
  expect(f.state().projects[0]?.followPaneId).toBe(f.paneId);
  const newPaneId = id();
  f.run({
    kind: "pane.split",
    projectId: f.projectId,
    expectedVersion: 1,
    tabId: f.tabId,
    paneId: f.paneId,
    newPaneId,
    splitId: id(),
    axis: "horizontal",
    before: true,
    profile: "shell",
  });
  expect(f.state().projects[0]?.followPaneId).toBe(f.paneId);
  f.run({
    kind: "pane.close",
    projectId: f.projectId,
    expectedVersion: 2,
    tabId: f.tabId,
    paneId: f.paneId,
  });
  expect(f.state().projects[0]?.directoryMode).toBe("pinned");
  expect(f.state().projects[0]?.followPaneId).toBeUndefined();
});
it("inherits the source pane directory without retargeting other panes", () => {
  const f = fixture();
  const source = f.state().projects[0]!.tabs[0]!.nodes[0]!;
  if (source.kind !== "pane") throw new Error();
  source.directory = "/home/dev/repo/src";
  f.run({
    kind: "tab.create",
    projectId: f.projectId,
    expectedVersion: 1,
    sourcePaneId: f.paneId,
    tabId: id(),
    paneId: id(),
    name: "Agent",
    profile: "chat",
  });
  expect(f.state().projects[0]?.tabs[1]?.nodes[0]).toMatchObject({
    directory: "/home/dev/repo/src",
  });
  expect(f.state().projects[0]?.directory).toBe("/home/dev");
});
