import { describe, expect, it } from "vitest";
import type { LayoutNode, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { paneDropTargetAt, paneLandingArea, paneMoveOperation } from "./pane-drop";

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

describe("paneLandingArea", () => {
  const land = (
    tab: WorkspaceTab,
    paneId: string,
    target: Parameters<typeof paneMoveOperation>[3],
  ) => {
    const project = projectOf(tab);
    const operation = paneMoveOperation(project, tab, paneId, target, NEW);
    return operation && paneLandingArea(project, tab, operation);
  };

  it("is half of a pane that is not the dragged pane's neighbour", () => {
    expect(land(grid, A, { scope: "pane", paneId: D, placement: "right" })).toEqual({
      left: 0.75,
      top: 0.5,
      width: 0.25,
      height: 0.5,
    });
    expect(land(grid, A, { scope: "pane", paneId: D, placement: "top" })).toEqual({
      left: 0.5,
      top: 0.5,
      width: 0.5,
      height: 0.25,
    });
    expect(land(three, B, { scope: "pane", paneId: A, placement: "right" })).toEqual({
      left: 0.25,
      top: 0,
      width: 0.25,
      height: 1,
    });
  });
  it("is the whole hovered pane for a swap", () => {
    expect(land(grid, A, { scope: "pane", paneId: D, placement: "center" })).toEqual({
      left: 0.5,
      top: 0.5,
      width: 0.5,
      height: 0.5,
    });
    expect(land(three, A, { scope: "pane", paneId: C, placement: "center" })).toEqual({
      left: 0.5,
      top: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });
  it("accounts for the old split collapsing beside the pane it left", () => {
    // C grows to the whole left column first, so A takes half of that, not half of C as it stands.
    expect(land(grid, A, { scope: "pane", paneId: C, placement: "right" })).toEqual({
      left: 0.25,
      top: 0,
      width: 0.25,
      height: 1,
    });
    // With two panes the other pane grows to the whole tab.
    expect(land(two, A, { scope: "pane", paneId: B, placement: "right" })).toEqual({
      left: 0.5,
      top: 0,
      width: 0.5,
      height: 1,
    });
    // B and C grow to the whole width, so A takes half of B's row.
    expect(land(three, A, { scope: "pane", paneId: B, placement: "left" })).toEqual({
      left: 0,
      top: 0,
      width: 0.5,
      height: 0.5,
    });
  });
  it("keeps existing split ratios", () => {
    const uneven = tabOf(ROOT, [
      split(ROOT, "horizontal", A, RIGHT, 0.2),
      split(RIGHT, "vertical", B, C),
      pane(A),
      pane(B),
      pane(C),
    ]);
    expect(land(uneven, B, { scope: "pane", paneId: A, placement: "center" })).toEqual({
      left: 0,
      top: 0,
      width: 0.2,
      height: 1,
    });
  });
  it("is half of the tab for the outer band, whatever the layout", () => {
    expect(land(grid, A, { scope: "workspace", placement: "bottom" })).toEqual({
      left: 0,
      top: 0.5,
      width: 1,
      height: 0.5,
    });
  });
});
