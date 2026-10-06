import type {
  AgentInfo,
  LayoutNode,
  TerminalInfo,
  WorkspaceProject,
  WorkspaceSnapshot,
  WorkspaceTab,
} from "@concors/protocol";
import { isLiveTerminalAgent } from "./agent-status";

/** The sidebar navigates to panes; saved, detached sessions are not active entries. */
export function visibleAgentSessions(
  workspace: WorkspaceSnapshot | null,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
) {
  const chatIds = new Set<string>();
  const terminalIds = new Set<string>();
  for (const project of workspace?.projects ?? [])
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId)
          (node.profile === "chat" ? chatIds : terminalIds).add(node.sessionId);
  return {
    chats: chats.filter((agent) => chatIds.has(agent.id)),
    terminals: terminals.filter(
      (session) => terminalIds.has(session.id) && isLiveTerminalAgent(session),
    ),
  };
}

/**
 * Names the user gave panes, by the session shown in them. Agents cannot be renamed themselves, so a
 * renamed pane is how someone names an agent, and every list of agents should say the same thing.
 */
export function paneNames(workspace: WorkspaceSnapshot | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const project of workspace?.projects ?? [])
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId && node.name)
          names.set(node.sessionId, node.name);
  return names;
}

/**
 * The pane a sidebar entry stands for, so renaming the entry renames that pane: the one whose name
 * `paneNames` shows, or else the first pane holding the session.
 */
export function agentPane(workspace: WorkspaceSnapshot | null, sessionId: string) {
  let found: {
    project: WorkspaceProject;
    tab: WorkspaceTab;
    pane: Extract<LayoutNode, { kind: "pane" }>;
  } | null = null;
  for (const project of workspace?.projects ?? [])
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId === sessionId && (!found || node.name))
          found = { project, tab, pane: node };
  return found;
}
