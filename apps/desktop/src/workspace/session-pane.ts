import type { WorkspaceSnapshot } from "@concors/protocol";

export interface SessionPane {
  projectId: string;
  tabId: string;
  paneId: string;
}
export interface PaneFocusRequest extends SessionPane {
  requestId: string;
}
export function findSessionPane(
  workspace: WorkspaceSnapshot | null,
  sessionId: string,
): SessionPane | null {
  for (const project of workspace?.projects ?? [])
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId === sessionId)
          return { projectId: project.id, tabId: tab.id, paneId: node.id };
  return null;
}
