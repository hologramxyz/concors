import {
  agentProviderName,
  type AgentInfo,
  type AgentProviderId,
  type LayoutNode,
  type TerminalInfo,
  type WorkspaceProject,
  type WorkspaceTab,
} from "@concors/protocol";
import { backgroundTerminals } from "@/terminal/background-terminals";
import { closedChats } from "./closed-chats";
import { AGENT_STATUS, agentDisplayStatus } from "./context";
import { isFailureSeen, isTerminalTurnSeen } from "./seen-updates";

/**
 * The dot that says an agent wants a look: red when it failed or waits for an answer, white (the
 * accent) when it finished. Tabs, sidebar rows and workspaces all read it from here, so they show
 * the same states in the same colours and clear together.
 */
export type AgentDot = "attention" | "done";
export const AGENT_DOT_COLOR: Record<AgentDot, string> = {
  attention: "bg-destructive",
  done: "bg-primary",
};

/** A question's dot lasts until it is answered; a finish's or failure's until the chat is opened. */
export function chatDot(agent: AgentInfo): AgentDot | undefined {
  if (agent.status === "failed") return isFailureSeen(agent) ? undefined : "attention";
  if (agent.status === "needs_input") return "attention";
  return agent.status === "done" && agent.attention && !agent.attention.seen ? "done" : undefined;
}

/** The most urgent of several dots. */
export function strongestDot(dots: readonly (AgentDot | undefined)[]): AgentDot | undefined {
  return dots.includes("attention") ? "attention" : dots.includes("done") ? "done" : undefined;
}

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
  dot: AgentDot | undefined;
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
    dot: chatDot(agent),
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
    dot:
      session.agentActivity === "needs_input"
        ? "attention"
        : turnDone && !isTerminalTurnSeen(session.id)
          ? "done"
          : undefined,
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
  return panesInReadingOrder(tab).flatMap((pane) => {
    const status = paneAgentStatus(pane, chats, terminals);
    return status ? [status] : [];
  });
}

function panesInReadingOrder(tab: WorkspaceTab) {
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
  return panes;
}

/** Whether a pane's agent earns a line in its tab's tooltip: it is busy, waiting or failed. */
export function isActiveStatus(status: AgentStatus) {
  return (
    status.running ||
    status.status === AGENT_STATUS.needs_input ||
    status.status === AGENT_STATUS.failed
  );
}

/** Needs input > failed > working > finished; 0 is nothing pending, as for a failure already seen. */
function statusUrgency(status: AgentStatus) {
  if (status.status === AGENT_STATUS.needs_input) return 4;
  if (status.status === AGENT_STATUS.failed) return status.dot ? 3 : 0;
  if (status.running) return 2;
  return status.dot === "done" ? 1 : 0;
}

/**
 * The pane whose status a tab's one icon shows, or null with nothing pending. On a tie the focused
 * pane wins, then the first in reading order.
 */
export function mostUrgentPane(
  tab: WorkspaceTab,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
  focusedPaneId: string | null | undefined,
): Extract<LayoutNode, { kind: "pane" }> | null {
  let best: Extract<LayoutNode, { kind: "pane" }> | null = null;
  let bestUrgency = 0;
  for (const pane of panesInReadingOrder(tab)) {
    const status = paneAgentStatus(pane, chats, terminals);
    const urgency = status ? statusUrgency(status) : 0;
    if (
      urgency > bestUrgency ||
      (urgency > 0 && urgency === bestUrgency && pane.id === focusedPaneId)
    ) {
      best = pane;
      bestUrgency = urgency;
    }
  }
  return best;
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
 * What a workspace's agents want, summed over its tabs and what was closed in it, so someone
 * switching between workspaces sees where to look. It counts exactly the dots its rows show.
 */
export function workspaceAttention(
  project: WorkspaceProject,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
): WorkspaceAttention {
  const scope = { projects: [project] };
  const statuses = [
    ...project.tabs.flatMap((tab) => tabAgentStatuses(tab, chats, terminals)),
    ...closedChats(scope, chats).map(({ agent }) => chatAgentStatus(agent)),
    ...backgroundTerminals(scope, terminals).filter(isLiveTerminalAgent).map(terminalAgentStatus),
  ];
  const needsInput = statuses.filter(
    (s) => s.dot === "attention" && s.status === AGENT_STATUS.needs_input,
  ).length;
  const failed = statuses.filter(
    (s) => s.dot === "attention" && s.status === AGENT_STATUS.failed,
  ).length;
  const done = statuses.filter((s) => s.dot === "done").length;
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

/**
 * What a workspace's dot is saying, such as "1 chat finished" or "2 chats need input, 1 failed".
 * Empty when there is no dot: a chat that is only working does not show one.
 */
export function workspaceAttentionLabel(attention: WorkspaceAttention): string {
  const counts: [number, string, string][] = [
    [attention.needsInput, "needs input", "need input"],
    [attention.failed, "failed", "failed"],
    [attention.done, "finished", "finished"],
  ];
  return counts
    .filter(([count]) => count > 0)
    .map(([count, one, many], index) => {
      const noun = index === 0 ? ` chat${count === 1 ? "" : "s"}` : "";
      return `${count}${noun} ${count === 1 ? one : many}`;
    })
    .join(", ");
}
