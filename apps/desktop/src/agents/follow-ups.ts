import { useSyncExternalStore } from "react";

/**
 * What Enter does with a message written while an agent works, as the Codex app's Follow-ups
 * setting: steer it into the running turn, or queue it for after. ⌘/Ctrl+Enter does the other.
 * A message that cannot steer (attachments, a slash command, a provider without steering) queues
 * either way. Kept per device, like keyboard shortcuts.
 */
export const FOLLOW_UP_MODES = ["steer", "queue"] as const;
export type FollowUpMode = (typeof FOLLOW_UP_MODES)[number];
export const FOLLOW_UP_KEY = "concors.follow-ups";

const listeners = new Set<() => void>();

function read(): FollowUpMode {
  try {
    return window.localStorage.getItem(FOLLOW_UP_KEY) === "queue" ? "queue" : "steer";
  } catch {
    return "steer";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === FOLLOW_UP_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useFollowUpMode(): FollowUpMode {
  return useSyncExternalStore(subscribe, read, () => "steer");
}

export function setFollowUpMode(mode: FollowUpMode) {
  try {
    window.localStorage.setItem(FOLLOW_UP_KEY, mode);
  } catch {
    // Without storage the choice still applies until the app reloads.
  }
  for (const listener of listeners) listener();
}
