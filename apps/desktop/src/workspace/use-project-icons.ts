import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ProjectIcon, WorkspaceSnapshot } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { projectIconKey, projectIcons } from "./project-icons";
const empty = new Map<string, ProjectIcon>();
const emptySnapshot = () => empty;
const emptySubscribe = () => () => undefined;

export function useProjectIcons(workspace: WorkspaceSnapshot | null) {
  const connection = useContext(TerminalConnectionContext);
  const cache = useMemo(() => (connection ? projectIcons(connection) : null), [connection]);
  const icons = useSyncExternalStore(
    cache?.subscribe ?? emptySubscribe,
    cache?.getSnapshot ?? emptySnapshot,
  );
  useEffect(() => {
    if (!connection || !cache || !workspace) return;
    const refresh = () => {
      if (document.visibilityState === "visible") cache.refresh(workspace);
    };
    const unsubscribe = connection.subscribe(refresh);
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [connection, cache, workspace]);
  return icons;
}

/** What the sidebar draws for a workspace (see `ProjectImage`): its favicon, a git initial or a folder. */
export interface WorkspaceImage {
  source: string | null;
  isGit: boolean;
  name: string;
}

/**
 * The sidebar's image for a workspace, by its ID, for rows away from the sidebar that name the
 * workspace, so a workspace wears one icon across the window. Null for a workspace it does not
 * know, which then shows the plain folder.
 */
export const WorkspaceImageContext = createContext<(projectId: string) => WorkspaceImage | null>(
  () => null,
);

/** The lookup `WorkspaceImageContext` provides: a closed workspace has no image, so its folder. */
export function useWorkspaceImages(workspace: WorkspaceSnapshot | null) {
  const icons = useProjectIcons(workspace);
  return useCallback(
    (projectId: string): WorkspaceImage | null => {
      if (!workspace) return null;
      const open = workspace.projects.find((project) => project.id === projectId);
      if (open) {
        const icon = icons.get(projectIconKey(workspace.epoch, open));
        return { source: icon?.source ?? null, isGit: icon?.isGit ?? false, name: open.name };
      }
      const closed = workspace.closedProjects?.find((project) => project.id === projectId);
      return closed ? { source: null, isGit: false, name: closed.name } : null;
    },
    [workspace, icons],
  );
}
