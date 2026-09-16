import { useSyncExternalStore } from "react";
import type { DaemonConnection } from "@concors/daemon-client";

export interface PreviewLink {
  name: string;
  url: string;
}
const EMPTY: Readonly<Record<string, PreviewLink>> = {};
export function createPreviewStore() {
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
    setLink(id: string, value: string, name = "") {
      const url = validPreviewUrl(value);
      if (!url) return;
      links = { ...links, [id]: { url, name: name.trim().slice(0, 80) || new URL(url).hostname } };
      for (const notify of listeners) notify();
    },
    removeLink(id: string) {
      const { [id]: _removed, ...next } = links;
      links = next;
      for (const notify of listeners) notify();
    },
  };
}
const emptyStore = createPreviewStore();
const stores = new WeakMap<DaemonConnection, ReturnType<typeof createPreviewStore>>();
export function usePreviewLinks(connection: DaemonConnection | null) {
  const store = connection ? (stores.get(connection) ?? createPreviewStore()) : emptyStore;
  if (connection) stores.set(connection, store);
  const links = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { links, setLink: store.setLink, removeLink: store.removeLink };
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
