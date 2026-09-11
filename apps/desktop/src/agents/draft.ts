import {
  createContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { draftStorageKey, readDraft, writeDraft } from "./draft-storage";
import type { AgentAttachment, AgentOperation } from "@concors/protocol";
/** Mobile keeps a per-machine draft scope while its native socket pauses/reconnects. */
export const AgentDraftScopeContext = createContext<object | null>(null);
export interface InputDraft {
  message: string;
  attachments: AgentAttachment[];
}
export interface ComposerAttempt {
  id: string;
  draft: InputDraft;
  operation: Extract<AgentOperation, { kind: "send" | "queue-add" | "steer" }>;
}
interface Draft extends InputDraft {
  queue: InputDraft[];
  uncertain: boolean;
  busy: boolean;
}
interface Session {
  attempt: ComposerAttempt | null;
  sending: boolean;
}
const empty: Draft = { message: "", attachments: [], queue: [], uncertain: false, busy: false };
interface DraftStore {
  values: Map<string, Draft>;
  sessions: Map<string, Session>;
  listeners: Set<() => void>;
  restored: Set<string>;
}
const stores = new WeakMap<object, DraftStore>();
const disconnected = {};
/** Drafts are scoped to a machine/session; storage restores uncertain request IDs without resending. */
export function useAgentDraft(connection: object | null, id: string, machineId?: string) {
  const key = connection ?? disconnected;
  let cached = stores.get(key);
  if (!cached) {
    cached = { values: new Map(), sessions: new Map(), listeners: new Set(), restored: new Set() };
    stores.set(key, cached);
  }
  const store = cached;
  const storageKey = machineId ? draftStorageKey(machineId, id) : null;
  if (storageKey && !store.restored.has(storageKey)) {
    store.restored.add(storageKey);
    try {
      const saved = readDraft(localStorage, storageKey);
      if (saved && !store.values.has(id)) {
        const attempt =
          saved.attempt && ["send", "queue-add", "steer"].includes(saved.attempt.operation.kind)
            ? (saved.attempt as ComposerAttempt)
            : null;
        store.values.set(id, { ...saved.draft, busy: false, uncertain: !!attempt });
        store.sessions.set(id, { attempt, sending: false });
      }
    } catch {
      /* Native webviews without storage retain the in-memory draft scope. */
    }
  }
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
    if (
      !draft.message &&
      !draft.attachments.length &&
      !draft.queue.length &&
      !draft.uncertain &&
      !draft.busy
    )
      store.values.delete(id);
    else store.values.set(id, draft);
    if (storageKey)
      try {
        writeDraft(localStorage, storageKey, {
          version: 1,
          updatedAt: Date.now(),
          draft: { message: draft.message, attachments: draft.attachments, queue: draft.queue },
          attempt: store.sessions.get(id)?.attempt ?? null,
        });
      } catch {
        /* Storage may be unavailable in a native webview. */
      }
    for (const listener of store.listeners) listener();
  };
  const sessionRefs = useMemo(() => {
    let session = store.sessions.get(id);
    if (!session) {
      session = { attempt: null, sending: false };
      store.sessions.set(id, session);
    }
    const current = session;
    return {
      attempt: {
        get current() {
          return current.attempt;
        },
        set current(next: ComposerAttempt | null) {
          current.attempt = next;
        },
      },
      sending: {
        get current() {
          return current.sending;
        },
        set current(next: boolean) {
          current.sending = next;
        },
      },
    };
  }, [store, id]);
  return {
    draft: value.message,
    attachments: value.attachments,
    queue: value.queue,
    uncertain: value.uncertain,
    busy: value.busy,
    ...sessionRefs,
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
    setQueue: (next: SetStateAction<InputDraft[]>) =>
      update((prior) => ({
        ...prior,
        queue: typeof next === "function" ? next(prior.queue) : next,
      })),
    setUncertain: (uncertain: boolean) => update((prior) => ({ ...prior, uncertain })),
    setBusy: (busy: boolean) => update((prior) => ({ ...prior, busy })),
  };
}
