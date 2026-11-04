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

/** The command for a drop. The workspace scope ignores its target, but the protocol requires one. */
export function paneMoveOperation(
  project: WorkspaceProject,
  tab: WorkspaceTab,
  paneId: string,
  target: PaneDropTarget,
  splitId: string,
): Extract<WorkspaceOperation, { kind: "pane.move" }> | null {
  const targetPaneId =
    target.scope === "pane"
      ? target.paneId
      : tab.nodes.find((node) => node.kind === "pane" && node.id !== paneId)?.id;
  if (!targetPaneId) return null;
  return {
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
}

/**
 * Where a pane would really end up. That is not always half of the hovered pane: leaving collapses
 * the split the pane came from, which can first grow its neighbours. So this runs the daemon's own
 * reducer over a copy and measures the result, which keeps the outline from promising otherwise.
 * Null if the daemon would refuse the move.
 */
export function paneLandingArea(
  project: WorkspaceProject,
  tab: WorkspaceTab,
  operation: Extract<WorkspaceOperation, { kind: "pane.move" }>,
): PaneArea | null {
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
      operation,
    ).projects[0]?.tabs[0];
  } catch {
    return null;
  }
  if (!moved) return null;
  const nodes = new Map(moved.nodes.map((node) => [node.id, node]));
  const find = (id: string, area: PaneArea): PaneArea | null => {
    const node = nodes.get(id);
    if (!node) return null;
    if (node.kind === "pane") return node.id === operation.paneId ? area : null;
    const firstShare = node.ratio;
    return node.axis === "horizontal"
      ? (find(node.first, { ...area, width: area.width * firstShare }) ??
          find(node.second, {
            ...area,
            left: area.left + area.width * firstShare,
            width: area.width * (1 - firstShare),
          }))
      : (find(node.first, { ...area, height: area.height * firstShare }) ??
          find(node.second, {
            ...area,
            top: area.top + area.height * firstShare,
            height: area.height * (1 - firstShare),
          }));
  };
  return find(moved.root, { left: 0, top: 0, width: 1, height: 1 });
}
