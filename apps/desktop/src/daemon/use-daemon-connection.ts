import { WorkspaceOperationSchema } from "@concors/protocol";
import {
  DaemonConnection,
  type ConnectionState,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import type { ClientInfo, WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import { useEffect, useRef, useState } from "react";

import { detectPlatform } from "@/lib/platform";
import { APP_VERSION } from "@/version";

const CLIENT_INFO: ClientInfo = {
  kind: "desktop",
  name: "concors-desktop",
  version: APP_VERSION,
  platform: detectPlatform(),
};

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export interface DaemonConnectionHandle {
  readonly state: ConnectionState;
  readonly workspace: WorkspaceSnapshot | null;
  readonly workspaceReady: boolean;
  readonly execute: (operation: WorkspaceOperation) => Promise<void>;
  /** Retry immediately instead of waiting for the current backoff. */
  readonly reconnectNow: () => void;
}

/**
 * Keeps one `DaemonConnection` alive for the given endpoint, reconnecting with exponential backoff
 * when it drops. Backoff policy lives here (in the client app) on purpose: a bundled local daemon
 * and a remote VPS deserve different treatment, and that is a product decision, not a protocol one.
 */
export function useDaemonConnection(endpoint: DaemonEndpoint | null): DaemonConnectionHandle {
  const [state, setState] = useState<ConnectionState>({ status: "disconnected" });
  const [replica, setReplica] = useState<{ url: string; snapshot: WorkspaceSnapshot } | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const activeConnection = useRef<DaemonConnection | null>(null);
  const retryNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (endpoint === null) return;

    let disposed = false;
    let retryDelay = INITIAL_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connection: DaemonConnection | null = null;
    let unsubscribe: () => void = () => undefined;
    let unsubscribeWorkspace: () => void = () => undefined;

    const dropCurrent = (): void => {
      // Unsubscribe first so the resulting "disconnected" event does not schedule a retry.
      unsubscribe();
      unsubscribeWorkspace();
      unsubscribe = () => undefined;
      connection?.disconnect();
      connection = null;
      activeConnection.current = null;
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(attempt, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    };

    const attempt = (): void => {
      if (disposed) return;
      dropCurrent();
      const next = new DaemonConnection({ endpoint, client: CLIENT_INFO });
      connection = next;
      activeConnection.current = next;
      setWorkspaceReady(false);
      unsubscribeWorkspace = next.subscribeWorkspace((snapshot) => {
        if (disposed || activeConnection.current !== next) return;
        setReplica({ url: endpoint.url, snapshot });
        setWorkspaceReady(true);
      });
      unsubscribe = next.subscribe((s) => {
        setState(s);
        if (s.status !== "ready") setWorkspaceReady(false);
        if (s.status === "ready") retryDelay = INITIAL_RETRY_MS;
        if (s.status === "disconnected" || s.status === "error") scheduleRetry();
      });
      next.connect().catch(() => {
        // Failure is already reflected in state (and a retry scheduled) by the subscriber above.
      });
    };

    retryNow.current = () => {
      retryDelay = INITIAL_RETRY_MS;
      clearTimeout(retryTimer);
      attempt();
    };

    attempt();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      dropCurrent();
      retryNow.current = () => undefined;
      setState({ status: "disconnected" });
    };
  }, [endpoint]);

  return {
    state,
    workspace: replica?.url === endpoint?.url ? (replica?.snapshot ?? null) : null,
    workspaceReady: workspaceReady && replica?.url === endpoint?.url,
    execute: async (operation) => {
      const connection = activeConnection.current;
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
    reconnectNow: () => retryNow.current(),
  };
}
