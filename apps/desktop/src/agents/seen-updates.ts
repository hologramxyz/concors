/**
 * Which failed chats and finished terminal agents this client has looked at, so viewing one clears
 * its dot as it does for a finished chat. The daemon keeps no attention record for either, leaving
 * nothing to mark as seen, so this is remembered here instead: per client rather than shared across
 * machines. Failures from before the first run count as seen, or every old failed chat would light
 * up at once.
 */
import type { AgentInfo } from "@concors/protocol";

const STORAGE_KEY = "concors.seen-updates";
const REMEMBERED = 512;

let since = "";
let seen = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      since?: string;
      seen?: Record<string, string>;
    } | null;
    since = stored?.since ?? "";
    seen = new Map(Object.entries(stored?.seen ?? {}));
  } catch {
    // Unreadable memory only means a failure shows its dot again.
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ since, seen: Object.fromEntries(seen) }));
  } catch {
    // Without storage this still holds until the window reloads.
  }
}

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export function startSeenMemory() {
  if (since) return;
  load();
  if (since) return;
  since = new Date().toISOString();
  save();
}

/** A later failure of the same chat has a later time, so it shows its dot again. */
export function isFailureSeen(agent: Pick<AgentInfo, "id" | "updatedAt">) {
  return seen.get(agent.id) === agent.updatedAt || agent.updatedAt < since;
}

export function markFailureSeen(agent: Pick<AgentInfo, "id" | "updatedAt">) {
  if (!isFailureSeen(agent)) remember(agent.id, agent.updatedAt);
}

function remember(key: string, value: string) {
  seen.delete(key);
  seen.set(key, value);
  for (const oldest of seen.keys()) {
    if (seen.size <= REMEMBERED) break;
    seen.delete(oldest);
  }
  save();
  changed();
}

const terminalKey = (id: string) => `terminal:${id}`;

export const isTerminalTurnSeen = (id: string) => seen.has(terminalKey(id));

export function markTerminalTurnSeen(id: string) {
  if (isTerminalTurnSeen(id)) return;
  remember(terminalKey(id), "seen");
}

/**
 * Terminals report no turn ID, so a new turn is noticed by its starting: from then on the next
 * finish is news again. A turn that starts and ends with this client closed goes unnoticed.
 */
export function forgetTerminalTurn(id: string) {
  if (seen.delete(terminalKey(id))) {
    save();
    changed();
  }
}

export const seenUpdatesVersion = () => version;

export function subscribeSeenUpdates(listener: () => void) {
  // Another window opening the chat clears the dot here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    load();
    changed();
  };
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
