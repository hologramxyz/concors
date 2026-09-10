import { WorkspaceOperationSchema } from "@concors/protocol";
import {
  type DaemonConnection,
  type ConnectionState,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import type { ClientInfo, WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import { useEffect, useRef, useState } from "react";

import { detectPlatform } from "@/lib/platform";
import { api } from "@/auth/api";
import { connectHost } from "./connect-host";
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
  /** Retry immediately instead of waiting for the current backoff. */
  readonly reconnectNow: () => void;
}

/**
 * Keeps one `DaemonConnection` alive for the given endpoint, reconnecting with exponential backoff
 * when it drops. Backoff policy lives here (in the client app) on purpose: a bundled local daemon
 * and a remote VPS deserve different treatment, and that is a product decision, not a protocol one.
 */
export function useDaemonConnection(
  endpoint: DaemonEndpoint | null,
  machineId = "local",
  scope = "",
): DaemonConnectionHandle {
  const key = `${scope}:${machineId}:${endpoint?.url}`;
  const [transport, setTransport] = useState<DaemonConnection | null>(null);
  const [state, setState] = useState<{ key: string; value: ConnectionState }>({
    key,
    value: { status: "disconnected" },
  });
  const [replica, setReplica] = useState<{ key: string; snapshot: WorkspaceSnapshot } | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const activeConnection = useRef<DaemonConnection | null>(null);
  const retryNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (endpoint === null) return;
    const session = connectHost({
      endpoint,
      machineId,
      api,
      client: CLIENT_INFO,
      isOnline: () => navigator.onLine,
      onTransport: (next) => {
        activeConnection.current = next;
        setTransport(next);
      },
      onState: (value) => {
        setState({ key, value });
        if (value.status !== "ready") setWorkspaceReady(false);
      },
      onWorkspace: (snapshot) => {
        setReplica({ key, snapshot });
        setWorkspaceReady(true);
      },
    });
    retryNow.current = session.reconnect;
    window.addEventListener("offline", session.offline);
    window.addEventListener("online", session.resume);
    return () => {
      window.removeEventListener("offline", session.offline);
      window.removeEventListener("online", session.resume);
      session.dispose();
      retryNow.current = () => undefined;
    };
  }, [endpoint, machineId, key]);

  return {
    state: state.key === key ? state.value : { status: "disconnected" },
    transport: state.key === key && transport?.endpoint.url === endpoint?.url ? transport : null,
    workspace: replica?.key === key ? (replica?.snapshot ?? null) : null,
    workspaceReady: workspaceReady && replica?.key === key,
    execute: async (operation) => {
      const connection = activeConnection.current;
      if (state.key !== key || !connection?.workspace || connection.endpoint.url !== endpoint?.url)
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
