import { ApiError, type ApiClient } from "@concors/api-client";
import {
  DaemonConnection,
  type ConnectionState,
  type DaemonConnectionOptions,
} from "@concors/daemon-client";
import type { WorkspaceSnapshot } from "@concors/protocol";

interface HostConnectionOptions extends Omit<DaemonConnectionOptions, "protocols"> {
  machineId: string;
  api: Pick<ApiClient, "mintMachineToken">;
  onState: (state: ConnectionState) => void;
  onTransport: (connection: DaemonConnection | null) => void;
  onWorkspace: (snapshot: WorkspaceSnapshot) => void;
  isOnline?: () => boolean;
}

/** One selected host's lifetime. Tokens stay in memory; each new socket gets a fresh token. */
export function connectHost(options: HostConnectionOptions) {
  let disposed = false;
  let blocked = false;
  let authRetried = false;
  let generation = 0;
  let delay = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: DaemonConnection | null = null;
  let unsubscribe: () => void = () => undefined;
  let unsubscribeWorkspace: () => void = () => undefined;
  const managed = options.machineId !== "local";

  function drop() {
    generation++;
    clearTimeout(timer);
    unsubscribe();
    unsubscribeWorkspace();
    current?.disconnect();
    current = null;
    options.onTransport(null);
  }
  function stop(message: string) {
    blocked = true;
    drop();
    options.onState({ status: "error", error: { code: "INTERNAL_ERROR", message } });
  }
  function retry(authentication: boolean, opaque = false) {
    if (disposed || blocked) return;
    if (authentication || opaque) {
      if (authRetried) {
        stop(
          authentication
            ? "Access revoked"
            : "Could not connect after refreshing access. The machine may be offline or access revoked.",
        );
        return;
      }
      authRetried = true;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void attempt(), authentication || opaque ? 0 : delay);
    if (!authentication && !opaque) delay = Math.min(delay * 2, 30_000);
  }
  async function attempt() {
    if (disposed || blocked) return;
    drop();
    const attemptGeneration = generation;
    if (options.endpoint.kind === "remote" && options.isOnline?.() === false) {
      options.onState({ status: "disconnected", reason: "Device is offline" });
      return;
    }
    options.onState({ status: "connecting" });
    let protocols: string[] | undefined;
    try {
      if (managed) {
        const { token } = await options.api.mintMachineToken(options.machineId);
        protocols = [`concors.bearer.${token}`];
      }
    } catch (error) {
      if (disposed || attemptGeneration !== generation) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        stop("Access revoked");
        return;
      }
      options.onState({
        status: "error",
        error: { code: "INTERNAL_ERROR", message: "Could not authorize this machine" },
      });
      retry(error instanceof ApiError && error.status === 401);
      return;
    }
    if (disposed || attemptGeneration !== generation) return;
    const connection = new DaemonConnection({ ...options, ...(protocols ? { protocols } : {}) });
    current = connection;
    options.onTransport(connection);
    unsubscribeWorkspace = connection.subscribeWorkspace(options.onWorkspace);
    unsubscribe = connection.subscribe((state) => {
      if (disposed || current !== connection) return;
      options.onState(state);
      if (state.status === "ready") {
        delay = 1_000;
        // A successful authenticated handshake ends this retry episode. Later token expiry
        // gets its own refresh, so a healthy session can outlive multiple 15-minute tokens.
        authRetried = false;
      }
      if (state.status === "disconnected") retry(managed && state.closeCode === 4401);
      if (state.status === "error") {
        const details =
          state.error.details && typeof state.error.details === "object"
            ? (state.error.details as Record<string, unknown>)
            : {};
        retry(
          managed && (details?.["closeCode"] === 4401 || details?.["status"] === 401),
          managed && details?.["websocketUpgradeFailed"] === true,
        );
      }
    });
    await connection.connect().catch(() => undefined); // The state subscription owns retry policy.
  }
  void attempt();
  return {
    // An explicit user retry starts a new authorization attempt; network events cannot unblock it.
    reconnect: () => {
      blocked = false;
      authRetried = false;
      delay = 1_000;
      void attempt();
    },
    resume: () => {
      if (!blocked) void attempt();
    },
    offline: () => {
      if (options.endpoint.kind === "local" || blocked) return;
      drop();
      options.onState({ status: "disconnected", reason: "Device is offline" });
    },
    dispose: () => {
      disposed = true;
      drop();
    },
  };
}
