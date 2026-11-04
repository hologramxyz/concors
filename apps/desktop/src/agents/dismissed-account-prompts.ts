import { useSyncExternalStore } from "react";

/**
 * Which providers' account prompts were dismissed, per machine. One dismissal answers for every
 * pane and tab on that machine, so it lives here rather than in each prompt, and it is remembered
 * across restarts because the question has not changed by then. A machine's ID is what identifies
 * it: a local daemon's address changes every launch.
 */
const STORAGE_KEY = "concors.dismissed-account-prompts";

let dismissed = load();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function subscribe(listener: () => void) {
  // Another window of this app dismissing it counts too.
  const reload = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    dismissed = load();
    notify();
  };
  if (!listeners.size) window.addEventListener("storage", reload);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", reload);
  };
}

export const accountPromptKey = (machine: string, provider: string) => `${machine}:${provider}`;

export function setAccountPromptDismissed(key: string, value: boolean) {
  if (dismissed.has(key) === value) return;
  dismissed = new Set(dismissed);
  if (value) dismissed.add(key);
  else dismissed.delete(key);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // In-memory dismissal still works until the app restarts.
  }
  notify();
}

export function useAccountPromptDismissed(key: string) {
  return useSyncExternalStore(subscribe, () => dismissed.has(key));
}
