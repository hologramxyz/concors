import { useSyncExternalStore } from "react";

/**
 * Which providers' account prompts were dismissed, per machine. One dismissal answers for every
 * pane and tab on that machine, so it lives here rather than in each prompt. Saying no to signing in
 * is remembered across restarts, because the question has not changed by then, and lasts until the
 * provider is next signed in: an account that later expires is a new question. Saying no to an
 * install is only for now, as a missing CLI stops chats working however often it is declined. A
 * machine's ID is what identifies it: a local daemon's address changes every launch.
 */
const STORAGE_KEY = "concors.dismissed-account-prompts";

let remembered = load();
const forNow = new Set<string>();
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
    remembered = load();
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

export function isAccountPromptDismissed(key: string) {
  return remembered.has(key) || forNow.has(key);
}

function save(next: Set<string>) {
  remembered = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // In-memory dismissal still works until the app restarts.
  }
}

export function setAccountPromptDismissed(key: string, value: boolean) {
  if (isAccountPromptDismissed(key) === value) return;
  if (value) save(new Set(remembered).add(key));
  else {
    forNow.delete(key);
    if (remembered.has(key)) {
      const next = new Set(remembered);
      next.delete(key);
      save(next);
    }
  }
  notify();
}

/** Dismisses a prompt until the app restarts or `setAccountPromptDismissed` clears it. */
export function dismissAccountPromptForNow(key: string) {
  if (isAccountPromptDismissed(key)) return;
  forNow.add(key);
  notify();
}

export function useAccountPromptDismissed(key: string) {
  return useSyncExternalStore(subscribe, () => isAccountPromptDismissed(key));
}
