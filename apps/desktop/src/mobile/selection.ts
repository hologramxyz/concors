import type { WorkspaceProject, WorkspaceSnapshot } from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import { tabPanes } from "@/workspace/tab-panes";
export { tabPanes, type PaneNode } from "@/workspace/tab-panes";
/** Mobile calls each leaf a tab, but keeps the original IDs and desktop split tree. */
export function projectPanes(project: WorkspaceProject) {
  return project.tabs.flatMap((tab) => {
    const panes = tabPanes(tab);
    return panes.map((pane, index) => ({
      tab,
      pane,
      // Split leaves have no saved names. Use the shared name and display position;
      // never manufacture local-only names or change the shared tab to flatten it.
      label: panes.length === 1 ? tab.name : `${tab.name} · ${index + 1}`,
      profileLabel: pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile],
    }));
  });
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
