import {
  createContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { draftStorageKey, readDraft, savedAttachments, writeDraft } from "./draft-storage";
import type { AgentOperation } from "@concors/protocol";
import type { DraftAttachment } from "./attachment-uploads";
/** Mobile keeps a per-machine draft scope while its native socket pauses/reconnects. */
export const AgentDraftScopeContext = createContext<object | null>(null);
export interface InputDraft {
  message: string;
  attachments: DraftAttachment[];
}
const saveable = (draft: InputDraft) => ({
  message: draft.message,
  attachments: savedAttachments(draft.attachments),
});
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
function storeFor(connection: object | null): DraftStore {
  const key = connection ?? disconnected;
  let cached = stores.get(key);
  if (!cached) {
    cached = { values: new Map(), sessions: new Map(), listeners: new Set(), restored: new Set() };
    stores.set(key, cached);
  }
  return cached;
}
/** Keeps a draft in memory and in storage; an empty one is forgotten in both. */
function save(store: DraftStore, id: string, storageKey: string | null, draft: Draft) {
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
      const attempt = store.sessions.get(id)?.attempt;
      writeDraft(localStorage, storageKey, {
        version: 1,
        updatedAt: Date.now(),
        draft: { ...saveable(draft), queue: draft.queue.map(saveable) },
        attempt: attempt ? { ...attempt, draft: saveable(attempt.draft) } : null,
      });
    } catch {
      /* Storage may be unavailable in a native webview. */
    }
}
/**
 * Carries the unsent message and attachments to the agent that replaces this one, as switching
 * to another provider's model does: the pane then shows the new agent, whose draft would be empty,
 * so the prompt seemed to vanish. The queue and any request in flight belong to the old
 * conversation and stay with it. A draft the new agent already has is left alone.
 */
export function moveAgentDraft(
  connection: object | null,
  machineId: string | undefined,
  from: string,
  to: string,
) {
  const store = storeFor(connection);
  const key = (id: string) => (machineId ? draftStorageKey(machineId, id) : null);
  const source = store.values.get(from);
  const target = store.values.get(to) ?? empty;
  if (!source || (!source.message && !source.attachments.length)) return;
  if (target.message || target.attachments.length) return;
  save(store, to, key(to), { ...target, message: source.message, attachments: source.attachments });
  save(store, from, key(from), { ...source, message: "", attachments: [] });
  for (const listener of store.listeners) listener();
}
/** Drafts are scoped to a machine/session; storage restores uncertain request IDs without resending. */
export function useAgentDraft(connection: object | null, id: string, machineId?: string) {
  const store = storeFor(connection);
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
    save(store, id, storageKey, change(store.values.get(id) ?? empty));
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
    setAttachments: (next: SetStateAction<DraftAttachment[]>) =>
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
