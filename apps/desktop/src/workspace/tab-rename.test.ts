import { expect, it } from "vitest";
import type { WorkspaceTab } from "@concors/protocol";
import { renameOperation, renameTarget } from "./tab-rename";

const project = { id: "project", version: 7 };
const agents = [
  { id: "c1", name: "Game QA" },
  { id: "c2", name: "HUD polish" },
];
const chat = (id: string, sessionId: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "pane" as const,
  profile: "chat" as const,
  sessionId,
  ...extra,
});
const split = (name: string) =>
  ({
    id: "tab",
    name,
    root: "s",
    nodes: [
      { id: "s", kind: "split", axis: "horizontal", ratio: 0.5, first: "a", second: "b" },
      chat("a", "c1"),
      chat("b", "c2"),
    ],
  }) as WorkspaceTab;
const single = (name: string, extra: Record<string, unknown> = {}) =>
  ({ id: "tab", name, root: "a", nodes: [chat("a", "c1", extra)] }) as WorkspaceTab;
const paneOf = (tab: WorkspaceTab, id: string) => {
  const node = tab.nodes.find((item) => item.id === id);
  if (node?.kind !== "pane") throw new Error(`No pane ${id}`);
  return node;
};

it("renames one pane of a split tab on the phone, never the tab its siblings share", () => {
  for (const name of ["Tab 1", "Combat"]) {
    const tab = split(name);
    const pane = paneOf(tab, "b");
    const target = renameTarget(tab, pane, true);
    // A target is what makes the phone menu show Rename.
    expect(target).toEqual({ kind: "pane", pane });
    expect(renameOperation(project, tab, target!, "  Boss fight ", name, agents)).toEqual({
      kind: "pane.rename",
      projectId: "project",
      expectedVersion: 7,
      tabId: "tab",
      paneId: "b",
      name: "Boss fight",
    });
  }
  // A daemon without pane names cannot rename it, so the menu leaves Rename out, as before.
  expect(renameTarget(split("Tab 1"), paneOf(split("Tab 1"), "b"), false)).toBeNull();
});

it("renames a tab with its own name, and an unnamed one by its pane, as desktop's rows do", () => {
  const named = single("Combat");
  const pane = paneOf(named, "a");
  // Phone (its pane) and desktop (the whole tab) agree.
  expect(renameTarget(named, pane, true)).toEqual({ kind: "tab" });
  expect(renameTarget(named, undefined, true)).toEqual({ kind: "tab" });
  expect(renameOperation(project, named, { kind: "tab" }, "Boss fight", "Combat", agents)).toEqual({
    kind: "tab.rename",
    projectId: "project",
    expectedVersion: 7,
    tabId: "tab",
    name: "Boss fight",
  });
  // Keeping the name, or clearing it, sends nothing.
  expect(renameOperation(project, named, { kind: "tab" }, " Combat ", "Combat", agents)).toBeNull();
  expect(renameOperation(project, named, { kind: "tab" }, "  ", "Combat", agents)).toBeNull();

  const unnamed = single("Tab 2");
  const target = { kind: "pane" as const, pane: paneOf(unnamed, "a") };
  expect(renameTarget(unnamed, paneOf(unnamed, "a"), true)).toEqual(target);
  expect(renameTarget(unnamed, undefined, true)).toEqual(target);
  // Without pane names, both rename the tab, as they did before.
  expect(renameTarget(unnamed, paneOf(unnamed, "a"), false)).toEqual({ kind: "tab" });
  expect(renameTarget(unnamed, undefined, false)).toEqual({ kind: "tab" });
});

it("clears a pane's name back to its chat's title, and sends nothing when it would not change", () => {
  const tab = single("Tab 1", { name: "Old" });
  const target = { kind: "pane" as const, pane: paneOf(tab, "a") };
  expect(renameOperation(project, tab, target, "", "Old", agents)).toMatchObject({
    kind: "pane.rename",
    name: null,
  });
  expect(renameOperation(project, tab, target, "Game QA", "Old", agents)).toMatchObject({
    name: null,
  });
  expect(renameOperation(project, tab, target, "Old", "Old", agents)).toBeNull();
});
