import type { AgentItem, WorkspaceSnapshot } from "@concors/protocol";
export function mergeItems(current: AgentItem[], incoming: AgentItem[]): AgentItem[] {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const prior = map.get(item.id);
    if (!prior || prior.revision <= item.revision) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => a.position - b.position);
}
export function findSession(workspace: WorkspaceSnapshot, sessionId: string) {
  for (const project of workspace.projects)
    for (const tab of project.tabs)
      for (const pane of tab.nodes)
        if (pane.kind === "pane" && pane.sessionId === sessionId) return { project, tab, pane };
  return null;
}
