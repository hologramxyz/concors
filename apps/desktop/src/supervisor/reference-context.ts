import { createContext } from "react";
import type { AgentInfo } from "@concors/protocol";

import type { SupervisorReference } from "./reference-text";
export type { SupervisorReference } from "./reference-text";

export const SupervisorReferences = createContext<readonly SupervisorReference[]>([]);

export function supervisorAgentName(agent: AgentInfo) {
  return agent.paneName || agent.tabName || agent.name;
}
