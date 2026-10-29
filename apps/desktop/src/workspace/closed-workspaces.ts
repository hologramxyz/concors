import type { ClosedProject, WorkspaceSnapshot } from "@concors/protocol";

/** How many recently closed workspaces the menu offers to reopen. */
const RECENT_SHOWN = 5;

export interface RecentlyClosed extends ClosedProject {
  /** Another listed or open workspace has the same name, so its folder tells them apart. */
  clashes: boolean;
}

/** The most recently closed workspaces, newest first. Each comes back by its ID. */
export function recentlyClosed(workspace: WorkspaceSnapshot | null): RecentlyClosed[] {
  const recent = (workspace?.closedProjects ?? []).slice(0, RECENT_SHOWN);
  const names = [...(workspace?.projects ?? []), ...recent].map((project) => project.name);
  return recent.map((project) => ({
    ...project,
    clashes: names.filter((name) => name === project.name).length > 1,
  }));
}
