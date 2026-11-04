import { describe, expect, it } from "vitest";
import type { LayoutNode, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { paneDropTargetAt, planPaneDrop, type PaneDropTarget } from "./pane-drop";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, ROOT, LEFT, RIGHT, TAB, PROJECT, NEW] = Array.from({ length: 10 }, (_, n) =>
  id(n + 1),
) as [string, string, string, string, string, string, string, string, string, string];

const pane = (paneId: string): LayoutNode => ({
  id: paneId,
  kind: "pane",
  profile: "shell",
  sessionId: null,
});
const split = (
  splitId: string,
  axis: "horizontal" | "vertical",
  first: string,
  second: string,
  ratio = 0.5,
): LayoutNode => ({ id: splitId, kind: "split", axis, ratio, first, second });
const tabOf = (root: string, nodes: LayoutNode[]): WorkspaceTab =>
  ({ id: TAB, name: "Tab 1", root, nodes }) as WorkspaceTab;
const projectOf = (tab: WorkspaceTab): WorkspaceProject =>
  ({
    id: PROJECT,
    name: "Project",
    directory: "/project",
    version: 3,
    tabs: [tab],
  }) as WorkspaceProject;

/** A C | B D, read as columns: a top left, c bottom left, b top right, d bottom right. */
const grid = tabOf(ROOT, [
  split(ROOT, "horizontal", LEFT, RIGHT),
  split(LEFT, "vertical", A, C),
  split(RIGHT, "vertical", B, D),
  pane(A),
  pane(B),
  pane(C),
  pane(D),
]);
/** A on the left; b over c on the right. */
const three = tabOf(ROOT, [
  split(ROOT, "horizontal", A, RIGHT),
  split(RIGHT, "vertical", B, C),
  pane(A),
  pane(B),
  pane(C),
]);
const two = tabOf(ROOT, [split(ROOT, "horizontal", A, B), pane(A), pane(B)]);

describe("paneDropTargetAt", () => {
  const workspace = { left: 0, top: 0, right: 1000, bottom: 800 };
  const panes = [
    { id: A, rect: { left: 0, top: 0, right: 499, bottom: 800 } },
    { id: B, rect: { left: 500, top: 0, right: 1000, bottom: 800 } },
  ];
  const at = (x: number, y: number) => paneDropTargetAt(x, y, workspace, panes, A);

  it("takes half of the tab only in the narrow outer band", () => {
    expect(at(10, 400)).toEqual({ scope: "workspace", placement: "left" });
    expect(at(990, 400)).toEqual({ scope: "workspace", placement: "right" });
    expect(at(750, 10)).toEqual({ scope: "workspace", placement: "top" });
    expect(at(750, 790)).toEqual({ scope: "workspace", placement: "bottom" });
  });
  it("splits a pane in the band along each of its edges, a quarter of its size", () => {
    const edge = (placement: string) => ({ scope: "pane", paneId: B, placement });
    expect(at(600, 400)).toEqual(edge("left"));
    expect(at(900, 400)).toEqual(edge("right"));
    expect(at(750, 100)).toEqual(edge("top"));
    expect(at(750, 700)).toEqual(edge("bottom"));
  });
  it("swaps in the centre", () => {
    expect(at(750, 400)).toEqual({ scope: "pane", paneId: B, placement: "center" });
  });
  it("means nothing over the dragged pane or off the workspace", () => {
    expect(at(250, 400)).toBeNull();
    expect(at(-5, 400)).toBeNull();
    expect(at(1005, 400)).toBeNull();
  });
  it("keeps a target on the handle between two panes", () => {
    expect(at(499.4, 400)).toBeNull();
    expect(at(499.9, 400)).toEqual({ scope: "pane", paneId: B, placement: "left" });
  });
});

describe("planPaneDrop", () => {
  const plan = (tab: WorkspaceTab, paneId: string, target: PaneDropTarget) =>
    planPaneDrop(projectOf(tab), tab, paneId, target, NEW);
  const edge = (paneId: string, placement: "left" | "right" | "top" | "bottom") =>
    ({ scope: "pane", paneId, placement }) as const;

  it("outlines half of the hovered pane and nothing else, with no resize beside a stranger", () => {
    const right = plan(grid, A, edge(D, "right"));
    expect(right?.area).toEqual({ left: 0.75, top: 0.5, width: 0.25, height: 0.5 });
    expect(right?.resize).toBeNull();
    expect(plan(grid, A, edge(D, "top"))?.area).toEqual({
      left: 0.5,
      top: 0.5,
      width: 0.5,
      height: 0.25,
    });
    const threeWay = plan(three, B, edge(A, "right"));
    expect(threeWay?.area).toEqual({ left: 0.25, top: 0, width: 0.25, height: 1 });
    expect(threeWay?.resize).toBeNull();
  });
  it("stays inside the hovered pane beside the pane it left, and resizes to the same divider", () => {
    // Beyond the gap: B grows over A's old half, and the divider falls on the outline's edge.
    const right = plan(two, A, edge(B, "right"));
    expect(right?.area).toEqual({ left: 0.75, top: 0, width: 0.25, height: 1 });
    expect(right?.resize).toMatchObject({ kind: "pane.resize", splitId: NEW, ratio: 0.75 });
    expect(right?.resize?.expectedVersion).toBe(4);
    // Facing the gap: A takes the gap as well, and B keeps exactly the half the outline left it.
    const left = plan(two, A, edge(B, "left"));
    expect(left?.area).toEqual({ left: 0.5, top: 0, width: 0.25, height: 1 });
    expect(left?.resize).toMatchObject({ ratio: 0.75 });
    const stacked = plan(grid, A, edge(C, "right"));
    expect(stacked?.area).toEqual({ left: 0.25, top: 0.5, width: 0.25, height: 0.5 });
    // Half of the column as it will be, which is the midline C has now.
    expect(stacked?.resize).toBeNull();
    const row = plan(three, A, edge(B, "right"));
    expect(row?.area).toEqual({ left: 0.75, top: 0, width: 0.25, height: 0.5 });
    expect(row?.resize).toMatchObject({ ratio: 0.75 });
  });
  it("is the whole hovered pane for a swap, and never resizes", () => {
    const swap = plan(grid, A, { scope: "pane", paneId: D, placement: "center" });
    expect(swap?.area).toEqual({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 });
    expect(swap?.resize).toBeNull();
  });
  it("keeps existing split ratios", () => {
    const uneven = tabOf(ROOT, [
      split(ROOT, "horizontal", A, RIGHT, 0.2),
      split(RIGHT, "vertical", B, C),
      pane(A),
      pane(B),
      pane(C),
    ]);
    expect(plan(uneven, B, { scope: "pane", paneId: A, placement: "center" })?.area).toEqual({
      left: 0,
      top: 0,
      width: 0.2,
      height: 1,
    });
  });
  it("is half of the tab for the outer band, whatever the layout", () => {
    const outer = plan(grid, A, { scope: "workspace", placement: "bottom" });
    expect(outer?.area).toEqual({ left: 0, top: 0.5, width: 1, height: 0.5 });
    expect(outer?.resize).toBeNull();
  });
  it("is nothing when the daemon would refuse the move", () => {
    expect(plan(two, A, edge(A, "left"))).toBeNull();
  });
});
