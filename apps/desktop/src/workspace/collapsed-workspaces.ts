import { useSyncExternalStore } from "react";

/**
 * Which workspaces are collapsed in the sidebar, remembered per device across restarts. Only the
 * collapsed ones are kept, so a workspace nobody has touched, a new one included, is expanded.
 */
export const COLLAPSED_WORKSPACES_KEY = "concors.collapsed-workspaces";
// Closed workspaces keep their IDs, so old entries are harmless until there are too many.
const LIMIT = 200;

const listeners = new Set<() => void>();
// Without storage, the state lasts until the app reloads.
let fallback: string | null = null;
let raw: string | null = null;
// useSyncExternalStore compares snapshots by identity.
let snapshot: ReadonlySet<string> = new Set();

function read(): ReadonlySet<string> {
  let next: string | null;
  try {
    next = window.localStorage.getItem(COLLAPSED_WORKSPACES_KEY);
  } catch {
    next = fallback;
  }
  if (next === raw) return snapshot;
  raw = next;
  try {
    const ids: unknown = JSON.parse(next ?? "[]");
    snapshot = new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    snapshot = new Set();
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSED_WORKSPACES_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCollapsedWorkspaces(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

export function setWorkspaceExpanded(id: string, expanded: boolean) {
  const current = read();
  if (current.has(id) !== expanded) return;
  const next = [...current].filter((item) => item !== id);
  if (!expanded) next.push(id);
  const value = JSON.stringify(next.slice(-LIMIT));
  fallback = value;
  try {
    window.localStorage.setItem(COLLAPSED_WORKSPACES_KEY, value);
  } catch {
    /* Kept in memory instead; see `fallback`. */
  }
  for (const listener of listeners) listener();
}
