import {
  agentProviderName,
  type AgentInfo,
  type AgentProviderId,
  type LayoutNode,
  type TerminalInfo,
  type WorkspaceTab,
} from "@concors/protocol";
import { AGENT_STATUS, agentDisplayStatus } from "./context";

/**
 * What the sidebar and the tab strip show for one agent: its provider and where its turn is. Chat
 * agents and agent CLIs running in a terminal report progress differently; both end up here so
 * the two places cannot disagree about what "Done" means.
 */
export interface AgentStatus {
  id: string;
  provider: AgentProviderId;
  providerName: string;
  status: string;
  running: boolean;
  /** The dot shown when nothing is running. */
  color: string;
  unread: boolean;
}

export function chatAgentStatus(agent: AgentInfo): AgentStatus {
  const status = agentDisplayStatus(agent);
  return {
    id: agent.id,
    provider: agent.engine ?? agent.provider,
    providerName: agent.providerLabel ?? agentProviderName(agent.provider),
    running: agent.status === "starting" || agent.status === "working",
    status: AGENT_STATUS[status],
    color:
      status === "done"
        ? "bg-emerald-500"
        : status === "failed"
          ? "bg-red-500"
          : status === "needs_input"
            ? "bg-amber-500"
            : "bg-muted-foreground/60",
    unread: !!(agent.attention && !agent.attention.seen),
  };
}

export function terminalAgentStatus(session: TerminalInfo): AgentStatus {
  const turnDone = session.agentActivity === "idle" && !!session.agentTurnCompleted;
  return {
    id: session.id,
    provider: session.detectedAgent ?? session.profile,
    providerName: agentProviderName(session.detectedAgent ?? session.profile),
    running: session.status === "starting" || session.agentActivity === "working",
    status:
      session.status === "starting"
        ? "Starting"
        : session.agentActivity === "working"
          ? "Working"
          : session.agentActivity === "needs_input"
            ? "Needs input"
            : turnDone
              ? "Done"
              : "Open in terminal",
    color:
      session.agentActivity === "needs_input"
        ? "bg-amber-500"
        : turnDone
          ? "bg-emerald-500"
          : "bg-muted-foreground/60",
    unread: false,
  };
}

/** A terminal only counts as an agent while an agent CLI is live in it, as in the sidebar. */
export function isLiveTerminalAgent(session: TerminalInfo) {
  return (
    (session.profile !== "shell" || !!session.detectedAgent) &&
    (session.status === "running" || session.status === "starting")
  );
}

/** The agents in a tab's panes, in reading order (left to right, top to bottom). */
export function tabAgentStatuses(
  tab: WorkspaceTab,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
): AgentStatus[] {
  const nodes = new Map(tab.nodes.map((node) => [node.id, node]));
  const panes: Extract<LayoutNode, { kind: "pane" }>[] = [];
  const visit = (id: string) => {
    const node = nodes.get(id);
    if (node?.kind === "pane") panes.push(node);
    else if (node) {
      visit(node.first);
      visit(node.second);
    }
  };
  visit(tab.root);
  return panes.flatMap((pane) => {
    if (!pane.sessionId) return [];
    if (pane.profile === "chat") {
      const agent = chats.find((item) => item.id === pane.sessionId);
      return agent ? [chatAgentStatus(agent)] : [];
    }
    const session = terminals.find((item) => item.id === pane.sessionId);
    return session && isLiveTerminalAgent(session) ? [terminalAgentStatus(session)] : [];
  });
}
