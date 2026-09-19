import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PullRequestState, WorkspaceSnapshot } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { pullRequestStore, unavailablePullRequests } from "./store";

const unavailable = () => unavailablePullRequests;
const noSubscription = () => () => undefined;

/** Visible clients check once a minute and on focus; the store skips anything still fresh. */
export function usePullRequests(
  workspace: WorkspaceSnapshot | null,
  listed: PullRequestState = "open",
) {
  const connection = useContext(TerminalConnectionContext);
  const store = useMemo(
    () => (connection ? pullRequestStore(connection, listed) : null),
    [connection, listed],
  );
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getSnapshot ?? unavailable,
  );
  useEffect(() => {
    if (!connection || !store || !workspace) return;
    const refresh = () => {
      if (document.visibilityState === "visible") store.refresh(workspace);
    };
    const unsubscribe = connection.subscribe(refresh);
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [connection, store, workspace]);
  const refresh = useCallback(() => {
    if (store && workspace) store.refresh(workspace, true);
  }, [store, workspace]);
  return { ...state, refresh };
}
