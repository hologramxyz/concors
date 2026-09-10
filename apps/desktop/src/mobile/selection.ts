import type { LayoutNode, WorkspaceSnapshot, WorkspaceTab } from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
export type PaneNode = Extract<LayoutNode, { kind: "pane" }>;
/** Traverse the saved split tree, not storage order. Never rewrite the desktop layout. */
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
export function resolveMobileSelection(workspace: WorkspaceSnapshot, target: MobileTarget) {
  if (target.sessionId) {
    for (const project of workspace.projects) {
      if (target.projectId && project.id !== target.projectId) continue;
      for (const tab of project.tabs) {
        const pane = tabPanes(tab).find((node) => node.sessionId === target.sessionId);
        if (pane) return { project, tab, pane };
      }
    }
    return null;
  }
  const project =
    workspace.projects.find((item) => item.id === target.projectId) ??
    workspace.projects.find((item) => item.id === workspace.selection?.projectId) ??
    workspace.projects[0];
  if (!project) return null;
  const tab = project.tabs.find((item) => item.id === target.tabId) ?? project.tabs[0];
  if (!tab) return { project, tab: null, pane: null };
  const panes = tabPanes(tab);
  return {
    project,
    tab,
    pane: panes.find((item) => item.id === target.paneId) ?? panes[0] ?? null,
  };
}
export const PROFILE_LABELS = {
  chat: "Agent",
  shell: "Terminal",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
} as const;
