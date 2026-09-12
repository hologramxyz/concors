import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ProjectIcon, WorkspaceSnapshot } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { projectIcons } from "./project-icons";
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
