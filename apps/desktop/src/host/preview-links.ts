import { useSyncExternalStore } from "react";
import type { DaemonConnection } from "@concors/daemon-client";

const EMPTY: Readonly<Record<string, string>> = {};
function createStore() {
  let links = EMPTY;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => links,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLink(id: string, value: string) {
      const url = validPreviewUrl(value);
      if (!url) return;
      links = { ...links, [id]: url };
      for (const notify of listeners) notify();
    },
  };
}
const emptyStore = createStore();
const stores = new WeakMap<DaemonConnection, ReturnType<typeof createStore>>();
export function usePreviewLinks(connection: DaemonConnection | null) {
  const store = connection ? (stores.get(connection) ?? createStore()) : emptyStore;
  if (connection) stores.set(connection, store);
  const links = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { links, setLink: store.setLink };
}

export function validPreviewUrl(value: string, secureOnly = false): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (secureOnly && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}
