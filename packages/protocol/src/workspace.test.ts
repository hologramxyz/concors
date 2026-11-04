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

  it("renames a project and returns to its folder's name", () => {
    const { state, projectId } = fixture();
    let next = applyWorkspaceOperation(state, {
      kind: "project.rename",
      projectId,
      expectedVersion: 1,
      name: "Main app",
    });
    expect(next.projects[0]).toMatchObject({ name: "Main app", renamed: true, version: 2 });
    next = applyWorkspaceOperation(next, {
      kind: "project.rename",
      projectId,
      expectedVersion: 2,
      name: null,
    });
    expect(next.projects[0]).toMatchObject({ name: "concors", version: 3 });
    expect(next.projects[0]).not.toHaveProperty("renamed");
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

describe("pane.transfer", () => {
  /** A workspace of two tabs: `split` holds two panes, `other` one. */
  function twoTabs() {
    const { state, projectId, tabId, paneId } = fixture();
    const newPaneId = id();
    const otherTabId = id();
    const otherPaneId = id();
    let next = applyWorkspaceOperation(state, {
      kind: "pane.split",
      projectId,
      expectedVersion: 1,
      tabId,
      paneId,
      splitId: id(),
      newPaneId,
      axis: "horizontal",
      profile: "shell",
    });
    next = applyWorkspaceOperation(next, {
      kind: "tab.create",
      projectId,
      expectedVersion: 2,
      tabId: otherTabId,
      paneId: otherPaneId,
      name: "Review",
      profile: "chat",
    });
    return { next, projectId, tabId, paneId, newPaneId, otherTabId, otherPaneId };
  }
  const tabOf = (snapshot: WorkspaceSnapshot, tabId: string) =>
    snapshot.projects[0]!.tabs.find((tab) => tab.id === tabId);

  it("moves a pane into another tab, keeping its session, and collapses the split it left", () => {
    const { next, projectId, tabId, paneId, newPaneId, otherTabId, otherPaneId } = twoTabs();
    const bound = JSON.parse(JSON.stringify(next)) as WorkspaceSnapshot;
    const pane = tabOf(bound, tabId)!.nodes.find((node) => node.id === newPaneId);
    if (pane?.kind === "pane") pane.sessionId = id();
    const sessionId = pane?.kind === "pane" ? pane.sessionId : null;
    const splitId = id();
    const moved = applyWorkspaceOperation(bound, {
      kind: "pane.transfer",
      projectId,
      expectedVersion: 3,
      tabId,
      paneId: newPaneId,
      targetTabId: otherTabId,
      splitId,
    });
    const source = tabOf(moved, tabId)!;
    expect(source.root).toBe(paneId);
    expect(source.nodes.map((node) => node.id)).toEqual([paneId]);
    const destination = tabOf(moved, otherTabId)!;
    expect(destination.root).toBe(splitId);
    expect(destination.nodes.find((node) => node.id === splitId)).toMatchObject({
      first: otherPaneId,
      second: newPaneId,
      ratio: 0.5,
    });
    expect(destination.nodes.find((node) => node.id === newPaneId)).toMatchObject({ sessionId });
    expect(moved.selection).toEqual({ projectId, tabId: otherTabId });
    validateLayout(source);
    validateLayout(destination);
  });

  it("closes a tab whose only pane left", () => {
    const { next, projectId, otherTabId, otherPaneId, tabId } = twoTabs();
    const moved = applyWorkspaceOperation(next, {
      kind: "pane.transfer",
      projectId,
      expectedVersion: 3,
      tabId: otherTabId,
      paneId: otherPaneId,
      targetTabId: tabId,
      splitId: id(),
    });
    expect(tabOf(moved, otherTabId)).toBeUndefined();
    expect(moved.selection).toEqual({ projectId, tabId });
    expect(tabOf(moved, tabId)!.nodes.some((node) => node.id === otherPaneId)).toBe(true);
  });

  it("refuses its own tab, a missing tab, a split, and a stale version", () => {
    const { next, projectId, tabId, paneId, otherTabId } = twoTabs();
    const base = { kind: "pane.transfer", projectId, expectedVersion: 3, tabId } as const;
    expect(() =>
      applyWorkspaceOperation(next, { ...base, paneId, targetTabId: tabId, splitId: id() }),
    ).toThrow("different tab");
    expect(() =>
      applyWorkspaceOperation(next, { ...base, paneId, targetTabId: id(), splitId: id() }),
    ).toThrow();
    const split = tabOf(next, tabId)!.root;
    expect(() =>
      applyWorkspaceOperation(next, {
        ...base,
        paneId: split,
        targetTabId: otherTabId,
        splitId: id(),
      }),
    ).toThrow("different tab");
    expect(() =>
      applyWorkspaceOperation(next, {
        ...base,
        expectedVersion: 1,
        paneId,
        targetTabId: otherTabId,
        splitId: id(),
      }),
    ).toThrow("another client");
  });
});

describe("tab.transfer", () => {
  function twoWorkspaces(profile: "chat" | "shell" = "chat") {
    const { state, projectId } = fixture();
    const targetId = id();
    const tabId = id();
    const paneId = id();
    let next = applyWorkspaceOperation(state, {
      kind: "project.add",
      projectId: targetId,
      name: "Other",
      directory: "/projects/other",
    });
    next = applyWorkspaceOperation(next, {
      kind: "tab.create",
      projectId,
      expectedVersion: 1,
      tabId,
      paneId,
      name: "Chat",
      profile,
    });
    return { next, projectId, targetId, tabId, paneId };
  }
  const paneOf = (snapshot: WorkspaceSnapshot, projectIndex: number, paneId: string) =>
    snapshot.projects[projectIndex]!.tabs.flatMap((tab) => tab.nodes).find((n) => n.id === paneId);

  it("moves a chat under way, which stays in its folder, and the view goes with it", () => {
    const { next, projectId, targetId, tabId, paneId } = twoWorkspaces();
    const bound = JSON.parse(JSON.stringify(next)) as WorkspaceSnapshot;
    const pane = paneOf(bound, 0, paneId);
    const sessionId = id();
    if (pane?.kind === "pane") pane.sessionId = sessionId;
    const moved = applyWorkspaceOperation(bound, {
      kind: "tab.transfer",
      projectId,
      expectedVersion: 2,
      tabId,
      targetProjectId: targetId,
    });
    expect(moved.projects[0]!.tabs.some((tab) => tab.id === tabId)).toBe(false);
    expect(moved.projects[1]!.tabs.map((tab) => tab.id)).toEqual([tabId]);
    expect(paneOf(moved, 1, paneId)).toMatchObject({ sessionId, directory: "/projects/concors" });
    expect(moved.projects[0]!.version).toBe(3);
    expect(moved.projects[1]!.version).toBe(1);
    expect(moved.selection).toEqual({ projectId: targetId, tabId });
  });

  it("starts a chat that has not begun in the workspace it moved to", () => {
    const { next, projectId, targetId, tabId, paneId } = twoWorkspaces();
    const moved = applyWorkspaceOperation(next, {
      kind: "tab.transfer",
      projectId,
      expectedVersion: 2,
      tabId,
      targetProjectId: targetId,
    });
    expect(paneOf(moved, 1, paneId)).toMatchObject({ directory: "/projects/other" });
  });

  it("leaves the view alone when another tab moves", () => {
    const { next, projectId, targetId, tabId } = twoWorkspaces();
    const elsewhere = { projectId: targetId, tabId: null };
    const moved = applyWorkspaceOperation(
      { ...next, selection: elsewhere },
      { kind: "tab.transfer", projectId, expectedVersion: 2, tabId, targetProjectId: targetId },
    );
    expect(moved.selection).toEqual(elsewhere);
  });

  it("refuses terminals, its own workspace, and one that is gone", () => {
    const shell = twoWorkspaces("shell");
    expect(() =>
      applyWorkspaceOperation(shell.next, {
        kind: "tab.transfer",
        projectId: shell.projectId,
        expectedVersion: 2,
        tabId: shell.tabId,
        targetProjectId: shell.targetId,
      }),
    ).toThrow("Only chats");
    const chat = twoWorkspaces();
    const base = {
      kind: "tab.transfer",
      projectId: chat.projectId,
      expectedVersion: 2,
      tabId: chat.tabId,
    } as const;
    expect(() =>
      applyWorkspaceOperation(chat.next, { ...base, targetProjectId: chat.projectId }),
    ).toThrow("another workspace");
    expect(() => applyWorkspaceOperation(chat.next, { ...base, targetProjectId: id() })).toThrow();
  });
});
