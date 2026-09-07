import { createContext, useContext } from "react";
import type { AgentInfo } from "@concors/protocol";
export const AgentsContext = createContext<AgentInfo[]>([]);
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
