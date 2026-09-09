import {
  createContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
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
  operation: Extract<AgentOperation, { kind: "send" }>;
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
}
const stores = new WeakMap<object, DraftStore>();
const disconnected = {};
/** Connection-scoped memory survives pane/tab unmounts; no prompts or attachment data go to disk. */
export function useAgentDraft(connection: object | null, id: string) {
  const key = connection ?? disconnected;
  let cached = stores.get(key);
  if (!cached) {
    cached = { values: new Map(), sessions: new Map(), listeners: new Set() };
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
    if (
      !draft.message &&
      !draft.attachments.length &&
      !draft.queue.length &&
      !draft.uncertain &&
      !draft.busy
    )
      store.values.delete(id);
    else store.values.set(id, draft);
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
