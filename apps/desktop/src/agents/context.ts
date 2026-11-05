import { createContext, useContext } from "react";
import type { AgentInfo } from "@concors/protocol";
import { hasConversation } from "./provider-switch";
export const AgentsContext = createContext<AgentInfo[]>([]);
// Clients with local selection explicitly navigate after their own start/switch action.
export const AgentStartedContext = createContext<((sessionId: string) => void) | undefined>(
  undefined,
);
export function useAgents() {
  return useContext(AgentsContext);
}
export const AGENT_STATUS: Record<AgentInfo["status"], string> = {
  starting: "Starting",
  idle: "Ready",
  working: "Working",
  needs_input: "Needs input",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
};
/**
 * A brand-new chat whose agent is still starting, which only looks idle: for how a message is
 * delivered it is still starting. A resumed chat loading its history is not one.
 */
export function isNewChatStarting(agent: AgentInfo) {
  return agent.status === "starting" && !hasConversation(agent);
}
/**
 * The status to show for a chat agent. "Done" works like a notification: once the finished turn has
 * been seen, the agent reads as Ready again. A new chat reads as Ready while its agent starts.
 */
export function agentDisplayStatus(agent: AgentInfo): AgentInfo["status"] {
  return isNewChatStarting(agent) ||
    (agent.status === "done" && agent.attention?.kind === "done" && agent.attention.seen)
    ? "idle"
    : agent.status;
}
