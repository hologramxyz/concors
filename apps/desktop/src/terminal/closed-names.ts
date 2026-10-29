import { useSyncExternalStore } from "react";

/**
 * What each terminal's tab or pane was called when it closed, so it keeps that name while it runs
 * in the background. The daemon knows terminals but not their tabs, so this is kept per device.
 */
export const CLOSED_NAMES_KEY = "concors.closed-terminal-names";
// Terminal ids are never reused, so only the newest few names can still be in use.
const LIMIT = 50;

const listeners = new Set<() => void>();
// Without storage, names are kept until the app reloads.
let fallback: string | null = null;
let raw: string | null = null;
// useSyncExternalStore compares snapshots by identity.
let snapshot: ReadonlyMap<string, string> = new Map();

function read(): ReadonlyMap<string, string> {
  let next: string | null;
  try {
    next = window.localStorage.getItem(CLOSED_NAMES_KEY);
  } catch {
    next = fallback;
  }
  if (next === raw) return snapshot;
  raw = next;
  try {
    const entries: unknown = JSON.parse(next ?? "[]");
    snapshot = new Map(
      Array.isArray(entries)
        ? entries.filter(
            (entry): entry is [string, string] =>
              Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string",
          )
        : [],
    );
  } catch {
    snapshot = new Map();
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CLOSED_NAMES_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useClosedTerminalNames(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

export function closedTerminalName(terminalId: string): string | undefined {
  return read().get(terminalId);
}

export function rememberClosedNames(names: ReadonlyMap<string, string>) {
  if (!names.size) return;
  const next = new Map(read());
  for (const [id, name] of names) {
    next.delete(id);
    next.set(id, name);
  }
  const value = JSON.stringify([...next].slice(-LIMIT));
  fallback = value;
  try {
    window.localStorage.setItem(CLOSED_NAMES_KEY, value);
  } catch {
    /* Kept in memory instead; see `fallback`. */
  }
  for (const listener of listeners) listener();
}
