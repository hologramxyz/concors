import { createContext } from "react";
import type { AgentInfo, WorkspaceSnapshot } from "@concors/protocol";

import { referenceLabel, type SupervisorReference } from "./reference-text";
export type { SupervisorReference } from "./reference-text";

export const SupervisorReferences = createContext<readonly SupervisorReference[]>([]);

export function supervisorAgentName(agent: AgentInfo) {
  return agent.paneName || agent.tabName || agent.name;
}

/**
 * What `@` can mention: the agents in the machine's workspaces, the most recently active first,
 * since the session just run is the one most likely meant, then the workspaces themselves.
 */
export function supervisorReferences(
  workspace: Pick<WorkspaceSnapshot, "projects" | "closedProjects"> | null,
  agents: readonly AgentInfo[],
): SupervisorReference[] {
  const projects = [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])];
  const workspaces = new Map(projects.map((project) => [project.id, project.name]));
  return [
    ...agents
      .filter((agent) => !agent.supervisor && workspaces.has(agent.projectId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((agent) => ({
        id: agent.id,
        kind: "Agent" as const,
        label: referenceLabel(supervisorAgentName(agent)),
        workspace: workspaces.get(agent.projectId) ?? "",
      })),
    ...projects.map((project) => ({
      id: project.id,
      kind: "Workspace" as const,
      label: referenceLabel(project.name),
    })),
  ];
}
