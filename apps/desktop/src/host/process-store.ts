import type { DaemonConnection } from "@concors/daemon-client";
import { newRequestId } from "@concors/client-core";
import { RESOURCES_CAPABILITY, type ProcessSnapshot } from "@concors/protocol";

export interface ProcessState {
  snapshot: ProcessSnapshot | null;
  error: string | null;
  loading: boolean;
}
export const EMPTY_PROCESSES: ProcessState = { snapshot: null, error: null, loading: false };
const stores = new WeakMap<DaemonConnection, ReturnType<typeof createProcessStore>>();
export function processStore(connection: DaemonConnection) {
  let store = stores.get(connection);
  if (!store) {
    store = createProcessStore(connection);
    stores.set(connection, store);
  }
  return store;
}
export function createProcessStore(
  connection: Pick<
    DaemonConnection,
    "state" | "workspace" | "requestResource" | "subscribe" | "subscribeWorkspace"
  >,
) {
  let state: ProcessState = EMPTY_PROCESSES;
  let generation = 0;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeWorkspace: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (next: ProcessState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  const refresh = async () => {
    if (busy || !listeners.size) return;
    clearTimeout(timer);
    if (connection.state.status !== "ready") {
      update({
        snapshot: null,
        loading: false,
        error: "Connect to a machine to inspect its resources.",
      });
      return;
    }
    if (!connection.state.daemon.capabilities?.includes(RESOURCES_CAPABILITY)) {
      update({
        snapshot: null,
        loading: false,
        error: "Update the machine daemon to inspect processes.",
      });
      return;
    }
    if (!connection.workspace) return;
    const epoch = generation;
    busy = true;
    if (!state.snapshot) update({ snapshot: null, error: null, loading: true });
    try {
      const result = await connection.requestResource({ kind: "processes" }, newRequestId());
      if (epoch !== generation) return;
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (result.outcome.status !== "processes") throw new Error("Unexpected process response.");
      update({ snapshot: result.outcome.snapshot, error: null, loading: false });
    } catch (error) {
      if (epoch === generation)
        update({
          snapshot: null,
          loading: false,
          error: error instanceof Error ? error.message : "Could not inspect processes.",
        });
    } finally {
      if (epoch === generation) {
        busy = false;
        if (listeners.size) timer = setTimeout(() => void refresh(), 3000);
      }
    }
  };
  return {
    scope: newRequestId(),
    getSnapshot: () => state,
    refresh,
    subscribe(notify: () => void) {
      listeners.add(notify);
      if (listeners.size === 1) {
        generation++;
        busy = false;
        update(EMPTY_PROCESSES);
        unsubscribe = connection.subscribe(() => {
          if (connection.state.status !== "ready") {
            generation++;
            busy = false;
            clearTimeout(timer);
            update({
              snapshot: null,
              loading: false,
              error: "Machine disconnected. Reconnect to inspect resources.",
            });
          } else void refresh();
        });
        unsubscribeWorkspace = connection.subscribeWorkspace(() => {
          if (!state.snapshot) void refresh();
        });
        void refresh();
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          generation++;
          busy = false;
          clearTimeout(timer);
          unsubscribe?.();
          unsubscribeWorkspace?.();
        }
      };
    },
  };
}
