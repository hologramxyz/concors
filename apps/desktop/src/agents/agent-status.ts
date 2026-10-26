import {
  agentProviderName,
  type AgentInfo,
  type AgentProviderId,
  type LayoutNode,
  type TerminalInfo,
  type WorkspaceProject,
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
  /** Sub-agents still working in the background, which a chat that is done can still have. */
  background: number;
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
    background: agent.backgroundAgents ?? 0,
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
    background: 0,
  };
}

/** A terminal only counts as an agent while an agent CLI is live in it, as in the sidebar. */
export function isLiveTerminalAgent(session: TerminalInfo) {
  return (
    (session.profile !== "shell" || !!session.detectedAgent) &&
    (session.status === "running" || session.status === "starting")
  );
}

/** The agent a pane shows, chat or CLI in a terminal, or null when it shows none. */
export function paneAgentStatus(
  pane: Extract<LayoutNode, { kind: "pane" }>,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
): AgentStatus | null {
  if (!pane.sessionId) return null;
  if (pane.profile === "chat") {
    const agent = chats.find((item) => item.id === pane.sessionId);
    return agent ? chatAgentStatus(agent) : null;
  }
  const session = terminals.find((item) => item.id === pane.sessionId);
  return session && isLiveTerminalAgent(session) ? terminalAgentStatus(session) : null;
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
    const status = paneAgentStatus(pane, chats, terminals);
    return status ? [status] : [];
  });
}

export interface WorkspaceAttention {
  /** The most urgent state, which the workspace's badge shows; null when nothing is going on. */
  kind: "needs_input" | "failed" | "done" | "working" | null;
  needsInput: number;
  failed: number;
  done: number;
  working: number;
}

/**
 * What a workspace's agents want, summed over all its tabs, so someone switching between workspaces
 * sees where to look. Finished and failed agents count until they are seen, as their tabs' dots do.
 */
export function workspaceAttention(
  project: WorkspaceProject,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
): WorkspaceAttention {
  const statuses = project.tabs.flatMap((tab) => tabAgentStatuses(tab, chats, terminals));
  const needsInput = statuses.filter((s) => s.status === AGENT_STATUS.needs_input).length;
  const failed = statuses.filter((s) => s.unread && s.status === AGENT_STATUS.failed).length;
  const done = statuses.filter(
    (s) =>
      s.unread &&
      !s.running &&
      s.status !== AGENT_STATUS.failed &&
      s.status !== AGENT_STATUS.needs_input,
  ).length;
  const working = statuses.filter((s) => s.running).length;
  return {
    kind: needsInput
      ? "needs_input"
      : failed
        ? "failed"
        : done
          ? "done"
          : working
            ? "working"
            : null,
    needsInput,
    failed,
    done,
    working,
  };
}

/** "1 needs input · 2 done", for a workspace's tooltip. */
export function workspaceAttentionLabel(attention: WorkspaceAttention): string {
  return [
    attention.needsInput && `${attention.needsInput} needs input`,
    attention.failed && `${attention.failed} failed`,
    attention.done && `${attention.done} done`,
    attention.working && `${attention.working} working`,
  ]
    .filter(Boolean)
    .join(" · ");
}
