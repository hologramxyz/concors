import { createContext, useContext, useSyncExternalStore } from "react";

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
let fallback: FollowUpMode = "steer";
export const FollowUpPreferencesContext = createContext<{
  mode: FollowUpMode;
  save(mode: FollowUpMode): Promise<unknown>;
} | null>(null);

function read(): FollowUpMode {
  try {
    return window.localStorage.getItem(FOLLOW_UP_KEY) === "queue" ? "queue" : "steer";
  } catch {
    return fallback;
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
  const external = useContext(FollowUpPreferencesContext);
  const local = useSyncExternalStore<FollowUpMode>(subscribe, read, () => "steer");
  return external?.mode ?? local;
}

export function setFollowUpMode(mode: FollowUpMode) {
  fallback = mode;
  try {
    window.localStorage.setItem(FOLLOW_UP_KEY, mode);
  } catch {
    // Without storage the choice still applies until the app reloads.
  }
  for (const listener of listeners) listener();
}
