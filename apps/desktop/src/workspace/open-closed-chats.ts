import { useSyncExternalStore } from "react";

/**
 * Which workspaces show their closed chats in the sidebar. The group starts folded, so history
 * stays out of the way; one opened stays open, on this device, until it is folded again. Only open
 * ones are kept. The phone's web view has no localStorage, so there it lasts until the app reloads.
 */
export const OPEN_CLOSED_CHATS_KEY = "concors.open-closed-chats";
const LIMIT = 200;

const listeners = new Set<() => void>();
let fallback: string | null = null;
let raw: string | null | undefined;
let snapshot: ReadonlySet<string> = new Set();

function read(): ReadonlySet<string> {
  let next: string | null;
  try {
    next = window.localStorage.getItem(OPEN_CLOSED_CHATS_KEY);
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
    if (event.key === OPEN_CLOSED_CHATS_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useOpenClosedChats(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

export function setClosedChatsOpen(id: string, open: boolean) {
  const current = read();
  if (current.has(id) === open) return;
  const next = [...current].filter((item) => item !== id);
  if (open) next.push(id);
  const value = JSON.stringify(next.slice(-LIMIT));
  fallback = value;
  try {
    window.localStorage.setItem(OPEN_CLOSED_CHATS_KEY, value);
  } catch {
    /* Kept in memory instead; see `fallback`. */
  }
  for (const listener of listeners) listener();
}
