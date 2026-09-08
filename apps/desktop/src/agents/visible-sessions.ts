import type { AgentInfo, TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";

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
      (session) =>
        terminalIds.has(session.id) &&
        session.profile !== "shell" &&
        (session.status === "running" || session.status === "starting"),
    ),
  };
}
