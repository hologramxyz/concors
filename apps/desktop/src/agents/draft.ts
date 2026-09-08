import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import type { AgentAttachment } from "@concors/protocol";
interface Draft {
  message: string;
  attachments: AgentAttachment[];
}
const empty: Draft = { message: "", attachments: [] };
interface DraftStore {
  values: Map<string, Draft>;
  listeners: Set<() => void>;
}
const stores = new WeakMap<object, DraftStore>();
const disconnected = {};
/** Connection-scoped memory survives pane/tab unmounts without writing attachment data to disk. */
export function useAgentDraft(connection: object | null, id: string) {
  const key = connection ?? disconnected;
  let cached = stores.get(key);
  if (!cached) {
    cached = { values: new Map(), listeners: new Set() };
    stores.set(key, cached);
  }
  const store = cached;
  const value = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
      [store],
    ),
    useCallback(() => store.values.get(id) ?? empty, [store, id]),
    () => empty,
  );
  const update = (change: (prior: Draft) => Draft) => {
    const draft = change(store.values.get(id) ?? empty);
    if (!draft.message && !draft.attachments.length) store.values.delete(id);
    else store.values.set(id, draft);
    for (const listener of store.listeners) listener();
  };
  return {
    draft: value.message,
    attachments: value.attachments,
    setDraft: (next: SetStateAction<string>) =>
      update((prior) => ({
        ...prior,
        message: typeof next === "function" ? next(prior.message) : next,
      })),
    setAttachments: (next: SetStateAction<AgentAttachment[]>) =>
      update((prior) => ({
        ...prior,
        attachments: typeof next === "function" ? next(prior.attachments) : next,
      })),
  };
}
