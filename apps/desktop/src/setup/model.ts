import type { AgentAccount, AgentInfo, ProviderStatus, WorkspaceSnapshot } from "@concors/protocol";
import { mainPane } from "@/workspace/tab-title";

/** The steps, in order, as the rail lists them. */
export const SETUP_STEPS = [
  "Where agents run",
  "Your agents",
  "First project",
  "Your phone",
  "First agent",
] as const;

export type AgentReadiness = "ready" | "sign-in" | "checking" | "installing" | "missing";

/**
 * Where one agent stands: installed and signed in is ready to start a chat. An account not read
 * yet is being checked (`undefined`); one the machine cannot tell about (`null`, or an older
 * daemon) is left to the agent's own first run rather than blocking setup.
 */
export function agentReadiness(
  provider: Pick<ProviderStatus, "installed" | "installStatus">,
  account: Pick<AgentAccount, "status"> | null | undefined,
  accounts: boolean,
): AgentReadiness {
  if (!provider.installed)
    return provider.installStatus === "installing" ? "installing" : "missing";
  if (!accounts || account === null) return "ready";
  if (account === undefined) return "checking";
  return account.status === "disconnected" || account.status === "pending" ? "sign-in" : "ready";
}

/** A chat nobody has written in yet, which setup can hand its first task. */
export function isUntouchedChat(agent: Pick<AgentInfo, "status" | "turnId"> | undefined) {
  return !!agent && agent.status === "idle" && agent.turnId === null;
}

/**
 * Where the first task goes: the selected tab of the chosen workspace when its main pane is a chat
 * nobody wrote in yet. That chat's agent already started behind setup, so the task only switches
 * it to the agent and model chosen here and sends.
 */
export function firstChatTarget(workspace: WorkspaceSnapshot | null | undefined) {
  const project =
    workspace?.projects.find((candidate) => candidate.id === workspace.selection?.projectId) ??
    workspace?.projects[0];
  if (!project) return null;
  const tab =
    project.tabs.find((candidate) => candidate.id === workspace?.selection?.tabId) ??
    project.tabs[0];
  const pane = tab && mainPane(tab);
  return { project, tab, sessionId: pane?.profile === "chat" ? pane.sessionId : null };
}
