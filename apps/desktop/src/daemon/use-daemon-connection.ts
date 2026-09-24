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
  const [reconnecting, setReconnecting] = useState<{ key: string; since: number } | null>(null);
  const [noticed, setNoticed] = useState<typeof reconnecting>(null);
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
      onState: (value, restoring) => {
        setState({ key, value });
        if (value.status !== "ready") setWorkspaceReady(false);
        setReconnecting((current) =>
          !restoring ? null : current?.key === key ? current : { key, since: Date.now() },
        );
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

  useEffect(() => {
    if (!reconnecting) return;
    const timer = setTimeout(
      () => setNoticed(reconnecting),
      Math.max(0, reconnecting.since + RECONNECT_NOTICE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [reconnecting]);

  const current: ConnectionState = state.key === key ? state.value : { status: "disconnected" };
  return {
    state: current,
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
    link:
      current.status === "ready"
        ? "connected"
        : reconnecting?.key !== key
          ? "offline"
          : noticed === reconnecting
            ? "reconnecting"
            : "connected",
    error: current.status === "error" && reconnecting?.key !== key ? current.error.message : null,
    reconnectNow: () => retryNow.current(),
  };
}
