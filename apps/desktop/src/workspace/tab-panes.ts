import type { LayoutNode, WorkspaceTab } from "@concors/protocol";

export type PaneNode = Extract<LayoutNode, { kind: "pane" }>;

/** Display order follows the saved split tree, never node storage order. */
export function tabPanes(tab: WorkspaceTab): PaneNode[] {
  const nodes = new Map(tab.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const walk = (id: string): PaneNode[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    const node = nodes.get(id);
    return !node ? [] : node.kind === "pane" ? [node] : [...walk(node.first), ...walk(node.second)];
  };
  return walk(tab.root);
}
