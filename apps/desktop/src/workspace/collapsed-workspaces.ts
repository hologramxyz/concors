import { useSyncExternalStore } from "react";

/**
 * Which workspaces are collapsed in the sidebar, remembered per device across restarts. Only the
 * collapsed ones are kept, so a workspace nobody has touched, a new one included, is expanded.
 */
export const COLLAPSED_WORKSPACES_KEY = "concors.collapsed-workspaces";
// Closed workspaces keep their IDs, so old entries are harmless until there are too many.
export const COLLAPSED_WORKSPACES_LIMIT = 200;

/**
 * Where a host keeps the list instead of this window's localStorage: the phone, whose webview has
 * none, keeps it with its other preferences. `read` must return what `write` last wrote at once,
 * as the sidebar reads it back straight away. Desktop sets none.
 */
export interface CollapsedWorkspacesStorage {
  read(): readonly string[];
  write(ids: readonly string[]): void;
}
let storage: CollapsedWorkspacesStorage | null = null;

const listeners = new Set<() => void>();
// Without storage, the state lasts until the app reloads.
let fallback: string | null = null;
let raw: string | null = null;
// useSyncExternalStore compares snapshots by identity.
let snapshot: ReadonlySet<string> = new Set();

function read(): ReadonlySet<string> {
  let next: string | null;
  if (storage) next = JSON.stringify(storage.read());
  else
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
  const kept = next.slice(-COLLAPSED_WORKSPACES_LIMIT);
  if (storage) storage.write(kept);
  else {
    const value = JSON.stringify(kept);
    fallback = value;
    try {
      window.localStorage.setItem(COLLAPSED_WORKSPACES_KEY, value);
    } catch {
      /* Kept in memory instead; see `fallback`. */
    }
  }
  for (const listener of listeners) listener();
}

/** Keeps the list in `next` from now on, or in localStorage again for null. */
export function setCollapsedWorkspacesStorage(next: CollapsedWorkspacesStorage | null) {
  storage = next;
  for (const listener of listeners) listener();
}
