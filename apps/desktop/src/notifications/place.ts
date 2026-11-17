import { isDefaultTabName, type AgentInfo, type WorkspaceSnapshot } from "@concors/protocol";
import { agentPane } from "@/agents/visible-sessions";
import type { NoticePlace } from "./engine";

/** The name a notice from the Supervisor's chat gives as its place. */
export const SUPERVISOR_PLACE = "Supervisor";

/**
 * Where a notice says its agent is: its workspace, and its tab when someone named it. A tab nobody
 * named is called after its chat, which the notice already says. The Supervisor's chat is in no
 * workspace, so it is placed by name, or its notices would say nothing of where to look.
 */
export function noticePlace(
  workspace: Pick<WorkspaceSnapshot, "projects"> | null,
  agent: Pick<AgentInfo, "id" | "projectId" | "supervisor">,
): NoticePlace {
  if (agent.supervisor) return { projectId: agent.projectId, workspace: SUPERVISOR_PLACE, tab: "" };
  const pane = agentPane(workspace, agent.id);
  return {
    projectId: agent.projectId,
    workspace: workspace?.projects.find((p) => p.id === agent.projectId)?.name ?? "",
    tab: pane && !isDefaultTabName(pane.tab.name) ? pane.tab.name : "",
  };
}
