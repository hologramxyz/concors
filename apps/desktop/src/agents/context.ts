import { createContext, useContext } from "react";
import type { AgentInfo } from "@concors/protocol";
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
