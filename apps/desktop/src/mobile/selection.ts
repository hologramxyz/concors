import {
  UNTITLED_CHAT_NAME,
  type AgentInfo,
  type TerminalInfo,
  type WorkspaceProject,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import { tabPanes, type PaneNode } from "@/workspace/tab-panes";
import { defaultPaneTitle, tabTitle } from "@/workspace/tab-title";
export { tabPanes, type PaneNode } from "@/workspace/tab-panes";
type Agents = readonly Pick<AgentInfo, "id" | "name">[];
type Terminals = readonly Pick<TerminalInfo, "id" | "status" | "foregroundCommand">[];

/**
 * What tells one pane of a split tab from the others, as desktop titles panes: its own name, its
 * chat's title, or the command its terminal runs. Null when it has none yet (a chat nobody wrote
 * in, an idle terminal), which a phone would only show as "Agent" or "Terminal".
 */
function distinctPaneTitle(pane: PaneNode, agents: Agents, terminals: Terminals) {
  if (pane.name) return pane.name;
  const title = defaultPaneTitle(pane, agents, terminals);
  const generic = pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile];
  return title === UNTITLED_CHAT_NAME || title === generic ? null : title;
}

/**
 * Mobile calls each leaf a tab, but keeps the original IDs and desktop split tree. A tab with one
 * pane is labelled as desktop's tab strip labels it. Each pane of a split tab is labelled as desktop
 * titles that pane, so four chats in one tab read as their four conversations rather than "Main 1"
 * to "Main 4"; a pane with nothing to tell it apart yet keeps the tab's name and its position.
 * Labels come only from shared names; the shared tab is never changed to flatten it.
 */
export function projectPanes(
  project: WorkspaceProject,
  agents: Agents = [],
  terminals: Terminals = [],
) {
  return project.tabs.flatMap((tab) => {
    const panes = tabPanes(tab);
    const name = tabTitle(tab, agents, terminals);
    return panes.map((pane, index) => ({
      tab,
      pane,
      label:
        panes.length === 1
          ? name
          : (distinctPaneTitle(pane, agents, terminals) ?? `${name} ${index + 1}`),
      profileLabel: pane.name ?? pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile],
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
