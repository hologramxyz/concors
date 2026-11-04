import { clampRatio } from "./split-ratio";
import {
  applyWorkspaceOperation,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspaceTab,
} from "@concors/protocol";

/**
 * What dropping a dragged pane would do, as in split editors: an outer band of the workspace takes
 * half of the tab, a band along another pane's edge splits that pane, and its centre swaps the two.
 * Pure, so the geometry is tested without a pointer; the layout component only reads rectangles.
 */
export type PaneDropTarget =
  | { scope: "workspace"; placement: Side }
  | { scope: "pane"; placement: Side | "center"; paneId: string };
type Side = "left" | "right" | "top" | "bottom";
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** A share of the workspace, each value from 0 to 1. */
export interface PaneArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Narrow, in pixels, so the edge bands of the panes along the outside stay reachable. */
const OUTER_BAND = 32;
/** The share of a pane's size each of its edge bands takes; the rest is its centre. */
const PANE_EDGE_BAND = 0.25;

function nearestSide(distances: Record<Side, number>): Side {
  const sides = Object.keys(distances) as Side[];
  return sides.reduce((best, side) => (distances[side] < distances[best] ? side : best));
}

function distanceTo(rect: Rect, x: number, y: number) {
  return Math.hypot(
    Math.max(rect.left - x, 0, x - rect.right),
    Math.max(rect.top - y, 0, y - rect.bottom),
  );
}

/** What the pointer means. Off the workspace, or over the dragged pane itself, it means nothing. */
export function paneDropTargetAt(
  x: number,
  y: number,
  workspace: Rect,
  panes: readonly { id: string; rect: Rect }[],
  draggedPaneId: string,
): PaneDropTarget | null {
  if (x < workspace.left || x > workspace.right || y < workspace.top || y > workspace.bottom)
    return null;
  const outer = {
    left: x - workspace.left,
    right: workspace.right - x,
    top: y - workspace.top,
    bottom: workspace.bottom - y,
  };
  const outerSide = nearestSide(outer);
  if (outer[outerSide] < OUTER_BAND) return { scope: "workspace", placement: outerSide };
  // The nearest pane, not the one containing the point: the handles between panes belong to none,
  // and the outline should not blink off on the way across one.
  const hovered = panes.reduce<(typeof panes)[number] | null>(
    (best, pane) =>
      !best || distanceTo(pane.rect, x, y) < distanceTo(best.rect, x, y) ? pane : best,
    null,
  );
  if (!hovered || hovered.id === draggedPaneId) return null;
  const { left, top, right, bottom } = hovered.rect;
  const width = right - left;
  const height = bottom - top;
  const edge = {
    left: (x - left) / width,
    right: (right - x) / width,
    top: (y - top) / height,
    bottom: (bottom - y) / height,
  };
  const side = nearestSide(edge);
  return {
    scope: "pane",
    paneId: hovered.id,
    placement: edge[side] < PANE_EDGE_BAND ? side : "center",
  };
}

/** Every node's share of the workspace, from the layout's split ratios. */
function nodeAreas(tab: WorkspaceTab): Map<string, PaneArea> {
  const nodes = new Map(tab.nodes.map((node) => [node.id, node]));
  const areas = new Map<string, PaneArea>();
  const visit = (id: string, area: PaneArea) => {
    const node = nodes.get(id);
    if (!node) return;
    areas.set(id, area);
    if (node.kind === "pane") return;
    const { left, top, width, height } = area;
    if (node.axis === "horizontal") {
      const firstWidth = width * node.ratio;
      visit(node.first, { ...area, width: firstWidth });
      visit(node.second, { ...area, left: left + firstWidth, width: width - firstWidth });
    } else {
      const firstHeight = height * node.ratio;
      visit(node.first, { ...area, height: firstHeight });
      visit(node.second, { ...area, top: top + firstHeight, height: height - firstHeight });
    }
  };
  visit(tab.root, { left: 0, top: 0, width: 1, height: 1 });
  return areas;
}

function half(area: PaneArea, side: Side): PaneArea {
  const { left, top, width, height } = area;
  if (side === "left") return { ...area, width: width / 2 };
  if (side === "right") return { ...area, left: left + width / 2, width: width / 2 };
  if (side === "top") return { ...area, height: height / 2 };
  return { ...area, top: top + height / 2, height: height / 2 };
}

type PaneMove = Extract<WorkspaceOperation, { kind: "pane.move" }>;
type SplitResize = Extract<WorkspaceOperation, { kind: "pane.resize" }>;
export interface PaneDropPlan {
  /** The outline: half of the hovered pane, the whole of it for a swap, or half of the tab. */
  area: PaneArea;
  move: PaneMove;
  /** Puts the new divider on the hovered pane's midline, when the move alone would not. */
  resize: SplitResize | null;
}

/**
 * What a drop does, or null if the daemon would refuse it. It runs the daemon's own reducer over a
 * copy because leaving collapses the split the pane came from, which can grow the hovered pane
 * first. The resize then puts the divider back where the outline's inner edge is. It cannot always
 * make the two match: the space the pane left has to go to someone, so when that space lies beyond
 * the outline, or across the split's axis, the dragged pane or the hovered one grows to cover it.
 */
export function planPaneDrop(
  project: WorkspaceProject,
  tab: WorkspaceTab,
  paneId: string,
  target: PaneDropTarget,
  splitId: string,
): PaneDropPlan | null {
  const targetPaneId =
    target.scope === "pane"
      ? target.paneId
      : tab.nodes.find((node) => node.kind === "pane" && node.id !== paneId)?.id;
  if (!targetPaneId) return null;
  const move: PaneMove = {
    kind: "pane.move",
    projectId: project.id,
    tabId: tab.id,
    expectedVersion: project.version,
    paneId,
    targetPaneId,
    scope: target.scope,
    placement: target.placement,
    splitId,
  };
  let moved: WorkspaceTab | undefined;
  try {
    moved = applyWorkspaceOperation(
      {
        schemaVersion: 1,
        machineId: project.id,
        epoch: project.id,
        revision: 0,
        projects: [{ ...project, tabs: [tab] }],
        selection: null,
      },
      move,
    ).projects[0]?.tabs[0];
  } catch {
    return null;
  }
  if (!moved) return null;
  const hovered = nodeAreas(tab).get(targetPaneId);
  if (!hovered) return null;
  if (target.scope === "workspace")
    return {
      move,
      resize: null,
      area: half({ left: 0, top: 0, width: 1, height: 1 }, target.placement),
    };
  if (target.placement === "center") return { move, resize: null, area: hovered };
  const space = nodeAreas(moved).get(splitId);
  if (!space) return null;
  const horizontal = target.placement === "left" || target.placement === "right";
  const ratio = clampRatio(
    horizontal
      ? (hovered.left + hovered.width / 2 - space.left) / space.width
      : (hovered.top + hovered.height / 2 - space.top) / space.height,
  );
  return {
    move,
    area: half(hovered, target.placement),
    // The reducer starts every new split at half, and the move has raised the project's version.
    resize:
      Math.abs(ratio - 0.5) < 0.001
        ? null
        : {
            kind: "pane.resize",
            projectId: project.id,
            tabId: tab.id,
            expectedVersion: project.version + 1,
            splitId,
            ratio,
          },
  };
}
