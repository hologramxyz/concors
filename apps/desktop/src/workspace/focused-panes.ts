import { useSyncExternalStore } from "react";

/**
 * Which pane each open tab treats as focused, for the tab bar's icon. It lives outside React state
 * so a focus change repaints that one tab's label and not the workspace holding every pane. A tab
 * that has not been shown yet has no entry; nothing here survives a reload.
 */
const focused = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function publishFocusedPane(tabId: string, paneId: string) {
  if (focused.get(tabId) === paneId) return;
  focused.set(tabId, paneId);
  notify();
}

export function forgetFocusedPane(tabId: string) {
  if (focused.delete(tabId)) notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useFocusedPane(tabId: string): string | null {
  return useSyncExternalStore(subscribe, () => focused.get(tabId) ?? null);
}
