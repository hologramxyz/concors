import { useLayoutEffect } from "react";
import { setCollapsedWorkspacesStorage } from "@/workspace/collapsed-workspaces";
import { getHostState, hostAction } from "./bridge";

/**
 * Keeps the sidebar's folded workspaces with the phone's other preferences, as its webview has no
 * localStorage to keep them in like desktop does. A fold shows at once and is saved behind it.
 */
export function useHostCollapsedWorkspaces(saved: readonly string[]) {
  // By value: every state message from the host carries a new array.
  const key = JSON.stringify(saved);
  useLayoutEffect(() => {
    let ids = JSON.parse(key) as readonly string[];
    setCollapsedWorkspacesStorage({
      read: () => ids,
      write: (next) => {
        ids = next;
        const preferences = getHostState()?.preferences;
        if (preferences)
          hostAction({
            kind: "preferences",
            preferences: { ...preferences, collapsedWorkspaces: [...next] },
          });
      },
    });
    return () => setCollapsedWorkspacesStorage(null);
  }, [key]);
}
