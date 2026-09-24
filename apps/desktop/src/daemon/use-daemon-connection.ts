import { WorkspaceOperationSchema } from "@concors/protocol";
import {
  type DaemonConnection,
  type ConnectionState,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import type { ClientInfo, WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { detectPlatform } from "@/lib/platform";
import { api } from "@/auth/api";
import { connectHost } from "./connect-host";
import { DISCONNECTED, HostConnectionPool } from "./connection-pool";
import { APP_VERSION } from "@/version";

const CLIENT_INFO: ClientInfo = {
  kind: "desktop",
  name: "concors-desktop",
  version: APP_VERSION,
  platform: detectPlatform(),
};

export interface DaemonConnectionHandle {
  readonly state: ConnectionState;
  readonly transport: DaemonConnection | null;
  readonly workspace: WorkspaceSnapshot | null;
  readonly workspaceReady: boolean;
  readonly execute: (operation: WorkspaceOperation) => Promise<void>;
  /**
   * What to tell the user. A dropped connection that is being restored stays "connected" for
   * `RECONNECT_NOTICE_MS` so routine blips (token rotation) never flash a notice, then turns
   * "reconnecting". Gate edits on `state`, not on this.
   */
  readonly link: "connected" | "reconnecting" | "offline";
  /** A failure that needs the user; transient errors while reconnecting are not reported. */
  readonly error: string | null;
  /** Retry immediately instead of waiting for the current backoff. */
  readonly reconnectNow: () => void;
}

const RECONNECT_NOTICE_MS = 2_000;

/**
 * A machine left behind stays connected this long, so switching back is instant. Idle sockets are
 * cheap (a workspace subscription and a token renewal every few minutes); a handful is the cap.
 */
const pool = new HostConnectionPool({ idleMs: 10 * 60_000, maxIdle: 4 });
if (typeof window !== "undefined") {
  window.addEventListener("offline", () => pool.offline());
  window.addEventListener("online", () => pool.resume());
}

function connectionKey(endpoint: DaemonEndpoint | null, machineId: string, scope: string) {
  return `${scope}:${machineId}:${endpoint?.url}`;
}

function acquire(
  endpoint: DaemonEndpoint,
  machineId: string,
  scope: string,
  listener: () => void,
): () => void {
  return pool.acquire(
    { key: connectionKey(endpoint, machineId, scope), scope, machineId },
    (handlers) =>
      connectHost({
        endpoint,
        machineId,
        api,
        client: CLIENT_INFO,
        isOnline: () => navigator.onLine,
        ...handlers,
      }),
    listener,
  );
}

/** Starts connecting before the user commits (e.g. on hover), so selecting the machine is quicker. */
export function prewarmDaemonConnection(
  endpoint: DaemonEndpoint | null,
  machineId: string,
  scope: string,
) {
  if (endpoint && scope) acquire(endpoint, machineId, scope, () => undefined)();
}

/**
 * Keeps one `DaemonConnection` alive for the given endpoint, reconnecting with exponential backoff
 * when it drops. Backoff policy lives here (in the client app) on purpose: a bundled local daemon
 * and a remote VPS deserve different treatment, and that is a product decision, not a protocol one.
 * Every caller asking for the same machine shares one connection, and it outlives them briefly.
 */
export function useDaemonConnection(
  endpoint: DaemonEndpoint | null,
  machineId = "local",
  scope = "",
): DaemonConnectionHandle {
  const key = connectionKey(endpoint, machineId, scope);
  const subscribe = useCallback(
    (listener: () => void) =>
      endpoint === null ? () => undefined : acquire(endpoint, machineId, scope, listener),
    [endpoint, machineId, scope],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    endpoint === null ? DISCONNECTED : (pool.peek(key) ?? DISCONNECTED),
  );
  // Runs after any connection released in the same commit, so those are closed, not kept.
  useEffect(() => pool.setScope(scope), [scope]);

  const [noticed, setNoticed] = useState<string | null>(null);
  const restoring = snapshot.restoringSince === null ? null : `${key}:${snapshot.restoringSince}`;
  useEffect(() => {
    if (restoring === null || snapshot.restoringSince === null) return;
    const timer = setTimeout(
      () => setNoticed(restoring),
      Math.max(0, snapshot.restoringSince + RECONNECT_NOTICE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [restoring, snapshot.restoringSince]);

  const { state: current, transport } = snapshot;
  return {
    state: current,
    transport: transport?.endpoint.url === endpoint?.url ? transport : null,
    workspace: snapshot.workspace,
    workspaceReady: snapshot.workspaceReady,
    execute: async (operation) => {
      const connection = pool.peek(key)?.transport;
      if (!connection?.workspace || connection.endpoint.url !== endpoint?.url)
        throw new Error("Reconnect to edit this workspace");
      const result = await connection.executeWorkspace({
        type: "workspace.command",
        commandId: crypto.randomUUID(),
        epoch: connection.workspace.epoch,
        operation: WorkspaceOperationSchema.parse(operation),
      });
      if (result.outcome.status === "rejected") throw new Error(result.outcome.message);
    },
    link:
      current.status === "ready"
        ? "connected"
        : restoring === null
          ? "offline"
          : noticed === restoring
            ? "reconnecting"
            : "connected",
    error: current.status === "error" && restoring === null ? current.error.message : null,
    reconnectNow: () => pool.reconnect(key),
  };
}

/** Machines this device currently holds a live connection to, whether shown or idle. */
export function useReadyMachines(scope: string): ReadonlySet<string> {
  const ids = useSyncExternalStore(
    (listener) => pool.watch(listener),
    () => [...pool.readyMachines(scope)].sort().join("\n"),
  );
  return useMemo(() => new Set(ids ? ids.split("\n") : []), [ids]);
}
