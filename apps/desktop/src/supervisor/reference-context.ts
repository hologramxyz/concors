import { createContext } from "react";
import type { AgentInfo } from "@concors/protocol";

export interface SupervisorReference {
  id: string;
  kind: "Workspace" | "Agent";
  label: string;
  workspace?: string;
}

export const SupervisorReferences = createContext<readonly SupervisorReference[]>([]);

export function supervisorAgentName(agent: AgentInfo) {
  return agent.paneName || agent.tabName || agent.name;
}
