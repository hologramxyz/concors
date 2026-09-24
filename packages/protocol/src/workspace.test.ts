import { describe, expect, it } from "vitest";
import { applyWorkspaceOperation, validateLayout } from "./workspace-reducer.ts";
import {
  WorkspaceCommandSchema,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "./workspace.ts";

let sequence = 0;
const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
function fixture() {
  const projectId = id(),
    tabId = id(),
    paneId = id();
  const initial: WorkspaceSnapshot = {
    schemaVersion: 1,
    machineId: id(),
    epoch: id(),
    revision: 0,
    projects: [],
    selection: null,
  };
  const project = applyWorkspaceOperation(initial, {
    kind: "project.add",
    projectId,
    name: "Concors",
    directory: "/projects/concors",
  });
  const state = applyWorkspaceOperation(project, {
    kind: "tab.create",
    projectId,
    expectedVersion: 0,
    tabId,
    paneId,
    name: "Build",
    profile: "shell",
  });
  return { initial, state, projectId, tabId, paneId };
}

describe("workspace commands", () => {
  it("names a pane, keeps the name through a profile change and clears it", () => {
    const { state, projectId, tabId, paneId } = fixture();
    const pane = (snapshot: WorkspaceSnapshot) =>
      snapshot.projects[0]!.tabs[0]!.nodes.find((node) => node.id === paneId);
    let next = applyWorkspaceOperation(state, {
      kind: "pane.rename",
      projectId,
      tabId,
      expectedVersion: 1,
      paneId,
      name: "Dev server",
    });
    expect(pane(next)).toMatchObject({ name: "Dev server" });
    next = applyWorkspaceOperation(next, {
      kind: "pane.configure",
      projectId,
      tabId,
      expectedVersion: 2,
      paneId,
      profile: "chat",
    });
    expect(pane(next)).toMatchObject({ name: "Dev server", profile: "chat" });
    next = applyWorkspaceOperation(next, {
      kind: "pane.rename",
      projectId,
      tabId,
      expectedVersion: 3,
      paneId,
      name: null,
    });
    expect(pane(next)).not.toHaveProperty("name");
  });

  it("splits, resizes and collapses a nested tree without changing the input", () => {
    const { state, projectId, tabId, paneId } = fixture();
    const second = id(),
      third = id(),
      split = id(),
      nested = id();
    let next = applyWorkspaceOperation(state, {
      kind: "pane.split",
      projectId,
      tabId,
      expectedVersion: 1,
      paneId,
      newPaneId: second,
      splitId: split,
      axis: "horizontal",
      profile: "chat",
    });
    next = applyWorkspaceOperation(next, {
      kind: "pane.split",
      projectId,
      tabId,
      expectedVersion: 2,
      paneId: second,
      newPaneId: third,
      splitId: nested,
      axis: "vertical",
      profile: "codex",
    });
    next = applyWorkspaceOperation(next, {
      kind: "pane.resize",
      projectId,
      tabId,
      expectedVersion: 3,
      splitId: split,
      ratio: 0.7,
    });
    next = applyWorkspaceOperation(next, {
      kind: "pane.close",
      projectId,
      tabId,
      expectedVersion: 4,
      paneId: second,
    });
    expect(next.projects[0]!.tabs[0]!.nodes).toEqual(
      expect.arrayContaining([
        { id: split, kind: "split", axis: "horizontal", ratio: 0.7, first: paneId, second: third },
      ]),
    );
    expect(next.projects[0]!.tabs[0]!.nodes).toHaveLength(3);
    expect(state.projects[0]!.tabs[0]!.nodes).toHaveLength(1);
  });

  it("rejects concurrent edits to one project while permitting unrelated project edits", () => {
    const { state, projectId, tabId } = fixture();
    const other = applyWorkspaceOperation(state, {
      kind: "project.add",
      projectId: id(),
      name: "Other",
      directory: "/other",
    });
    const op: WorkspaceOperation = {
      kind: "tab.rename",
      projectId,
      tabId,
      expectedVersion: 1,
      name: "Review",
    };
    const next = applyWorkspaceOperation(other, op);
    expect(next.projects[0]!.tabs[0]!.name).toBe("Review");
    expect(() => applyWorkspaceOperation(next, op)).toThrow("another client");
  });

  it("moves tabs, repairs selection on close, and removes the final pane's tab", () => {
    const { state, projectId, tabId, paneId } = fixture();
    const anotherTab = id();
    let next = applyWorkspaceOperation(state, {
      kind: "tab.create",
      projectId,
      expectedVersion: 1,
      tabId: anotherTab,
      paneId: id(),
      name: "Review",
      profile: "chat",
    });
    next = applyWorkspaceOperation(next, {
      kind: "tab.move",
      projectId,
      tabId: anotherTab,
      expectedVersion: 2,
      index: 0,
    });
    expect(next.projects[0]!.tabs.map((t) => t.id)).toEqual([anotherTab, tabId]);
    next = applyWorkspaceOperation(next, {
      kind: "tab.close",
      projectId,
      tabId: anotherTab,
      expectedVersion: 3,
    });
    expect(next.selection).toEqual({ projectId, tabId });
    next = applyWorkspaceOperation(next, {
      kind: "pane.close",
      projectId,
      tabId,
      paneId,
      expectedVersion: 4,
    });
    expect(next.selection).toEqual({ projectId, tabId: null });
    expect(next.projects[0]!.tabs).toHaveLength(0);
    next = applyWorkspaceOperation(next, { kind: "project.remove", projectId, expectedVersion: 5 });
    expect(next.selection).toBeNull();
  });

  it("rejects missing targets, colliding IDs, invalid ratios and cyclic layouts", () => {
    const { state, projectId, tabId, paneId } = fixture();
    expect(() =>
      applyWorkspaceOperation(state, { kind: "selection.set", projectId, tabId: id() }),
    ).toThrow("no longer exists");
    expect(() =>
      applyWorkspaceOperation(state, {
        kind: "pane.split",
        projectId,
        tabId,
        expectedVersion: 1,
        paneId,
        newPaneId: paneId,
        splitId: id(),
        axis: "horizontal",
        profile: "shell",
      }),
    ).toThrow("ID already exists");
    expect(
      WorkspaceCommandSchema.safeParse({
        type: "workspace.command",
        commandId: id(),
        epoch: state.epoch,
        operation: {
          kind: "pane.resize",
          projectId,
          tabId,
          expectedVersion: 1,
          splitId: id(),
          ratio: 1,
        },
      }).success,
    ).toBe(false);
    expect(() =>
      validateLayout({
        id: tabId,
        name: "Bad",
        root: paneId,
        nodes: [
          {
            id: paneId,
            kind: "split",
            axis: "horizontal",
            ratio: 0.5,
            first: paneId,
            second: paneId,
          },
        ],
      }),
    ).toThrow("cycle");
  });
});

it("keeps a binding for the same profile and detaches it for a different profile", () => {
  const { state, projectId, tabId, paneId } = fixture();
  const pane = state.projects[0]!.tabs[0]!.nodes[0]!;
  if (pane.kind !== "pane") throw new Error("Expected pane");
  pane.sessionId = id();
  const unchanged = applyWorkspaceOperation(state, {
    kind: "pane.configure",
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    profile: "shell",
  });
  expect(unchanged.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({
    profile: "shell",
    sessionId: pane.sessionId,
  });
  const changed = applyWorkspaceOperation(state, {
    kind: "pane.configure",
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    profile: "chat",
  });
  expect(changed.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({
    profile: "chat",
    sessionId: null,
  });
  expect(state.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({ sessionId: pane.sessionId });
});

describe("pane rearrangement", () => {
  it.each(["center", "left", "right", "top", "bottom"] as const)(
    "moves nested bound panes to %s without changing sessions",
    (placement) => {
      const { state, projectId, tabId, paneId } = fixture();
      const second = id(),
        third = id(),
        root = id(),
        nested = id(),
        newSplit = id();
      let current = applyWorkspaceOperation(state, {
        kind: "pane.split",
        projectId,
        tabId,
        paneId,
        expectedVersion: 1,
        newPaneId: second,
        splitId: root,
        axis: "horizontal",
        profile: "chat",
      });
      current = applyWorkspaceOperation(current, {
        kind: "pane.split",
        projectId,
        tabId,
        paneId: second,
        expectedVersion: 2,
        newPaneId: third,
        splitId: nested,
        axis: "vertical",
        profile: "codex",
      });
      for (const pane of current.projects[0]!.tabs[0]!.nodes)
        if (pane.kind === "pane") pane.sessionId = id();
      const original = JSON.stringify(current);
      const moved = applyWorkspaceOperation(current, {
        kind: "pane.move",
        projectId,
        tabId,
        paneId: second,
        targetPaneId: paneId,
        placement,
        splitId: newSplit,
        expectedVersion: 3,
      });
      const tab = moved.projects[0]!.tabs[0]!;
      expect(tab.nodes.filter((n) => n.kind === "pane")).toEqual(
        current.projects[0]!.tabs[0]!.nodes.filter((n) => n.kind === "pane"),
      );
      expect(tab.nodes).toHaveLength(5);
      expect(JSON.stringify(current)).toBe(original);
      validateLayout(tab);
      if (placement === "center") {
        expect(tab.nodes.find((n) => n.id === root)).toMatchObject({ first: second });
        expect(tab.nodes.find((n) => n.id === nested)).toMatchObject({ first: paneId });
      } else {
        expect(tab.nodes.find((n) => n.id === root)).toMatchObject({
          first: newSplit,
          second: third,
        });
        expect(tab.nodes.find((n) => n.id === newSplit)).toMatchObject({
          axis: ["left", "right"].includes(placement) ? "horizontal" : "vertical",
          first: ["left", "top"].includes(placement) ? second : paneId,
          second: ["left", "top"].includes(placement) ? paneId : second,
        });
      }
      expect(() =>
        applyWorkspaceOperation(moved, {
          kind: "pane.move",
          projectId,
          tabId,
          paneId: second,
          targetPaneId: paneId,
          placement,
          splitId: id(),
          expectedVersion: 3,
        }),
      ).toThrow(/changed on another client/);
      expect(() =>
        applyWorkspaceOperation(moved, {
          kind: "pane.move",
          projectId,
          tabId,
          paneId: second,
          targetPaneId: second,
          placement,
          splitId: id(),
          expectedVersion: 4,
        }),
      ).toThrow(/different panes/);
    },
  );
  it.each(["left", "right", "top", "bottom"] as const)(
    "moves nested panes to workspace %s without changing sessions",
    (placement) => {
      const { state, projectId, tabId, paneId } = fixture();
      const second = id(),
        third = id(),
        root = id(),
        nested = id(),
        newSplit = id();
      let current = applyWorkspaceOperation(state, {
        kind: "pane.split",
        projectId,
        tabId,
        paneId,
        expectedVersion: 1,
        newPaneId: second,
        splitId: root,
        axis: "horizontal",
        profile: "chat",
      });
      current = applyWorkspaceOperation(current, {
        kind: "pane.split",
        projectId,
        tabId,
        paneId: second,
        expectedVersion: 2,
        newPaneId: third,
        splitId: nested,
        axis: "vertical",
        profile: "codex",
      });
      for (const pane of current.projects[0]!.tabs[0]!.nodes)
        if (pane.kind === "pane") pane.sessionId = id();
      const original = JSON.stringify(current);
      const moved = applyWorkspaceOperation(current, {
        kind: "pane.move",
        projectId,
        tabId,
        paneId: second,
        targetPaneId: paneId,
        placement,
        scope: "workspace",
        splitId: newSplit,
        expectedVersion: 3,
      });
      const tab = moved.projects[0]!.tabs[0]!;
      expect(tab.nodes.filter((n) => n.kind === "pane")).toEqual(
        current.projects[0]!.tabs[0]!.nodes.filter((n) => n.kind === "pane"),
      );
      expect(tab.nodes).toHaveLength(5);
      expect(JSON.stringify(current)).toBe(original);
      validateLayout(tab);
      expect(tab.root).toBe(newSplit);
      expect(tab.nodes.find((n) => n.id === root)).toMatchObject({ first: paneId, second: third });
      expect(tab.nodes.find((n) => n.id === newSplit)).toMatchObject({
        axis: ["left", "right"].includes(placement) ? "horizontal" : "vertical",
        first: ["left", "top"].includes(placement) ? second : root,
        second: ["left", "top"].includes(placement) ? root : second,
      });
      expect(() =>
        applyWorkspaceOperation(moved, {
          kind: "pane.move",
          projectId,
          tabId,
          paneId: second,
          targetPaneId: paneId,
          placement,
          scope: "workspace",
          splitId: id(),
          expectedVersion: 3,
        }),
      ).toThrow(/changed on another client/);
      expect(() =>
        applyWorkspaceOperation(moved, {
          kind: "pane.move",
          projectId,
          tabId,
          paneId: second,
          targetPaneId: second,
          placement,
          scope: "workspace",
          splitId: id(),
          expectedVersion: 4,
        }),
      ).toThrow(/different panes/);
    },
  );
  it("collapses the old root when moving sibling panes into a different split", () => {
    const { state, projectId, tabId, paneId } = fixture();
    const second = id(),
      split = id(),
      replacement = id();
    const current = applyWorkspaceOperation(state, {
      kind: "pane.split",
      projectId,
      tabId,
      paneId,
      expectedVersion: 1,
      newPaneId: second,
      splitId: split,
      axis: "horizontal",
      profile: "shell",
    });
    const moved = applyWorkspaceOperation(current, {
      kind: "pane.move",
      projectId,
      tabId,
      paneId,
      targetPaneId: second,
      placement: "bottom",
      splitId: replacement,
      expectedVersion: 2,
    });
    expect(moved.projects[0]!.tabs[0]!.root).toBe(replacement);
    expect(moved.projects[0]!.tabs[0]!.nodes).toHaveLength(3);
    expect(moved.projects[0]!.tabs[0]!.nodes.find((n) => n.id === replacement)).toMatchObject({
      first: second,
      second: paneId,
      axis: "vertical",
    });
  });
});

it.each(["horizontal", "vertical"] as const)(
  "places a new pane before its sibling on the %s axis",
  (axis) => {
    const { state, projectId, tabId, paneId } = fixture();
    const newPaneId = id(),
      splitId = id();
    const updated = applyWorkspaceOperation(state, {
      kind: "pane.split",
      projectId,
      tabId,
      paneId,
      newPaneId,
      splitId,
      axis,
      before: true,
      profile: "shell",
      expectedVersion: 1,
    });
    const tab = updated.projects[0]!.tabs[0]!;
    expect(tab.nodes.find((n) => n.id === splitId)).toMatchObject({
      first: newPaneId,
      second: paneId,
      axis,
    });
    validateLayout(tab);
  },
);
