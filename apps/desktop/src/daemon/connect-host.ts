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
  /** `reconnecting`: an established connection dropped and is being restored automatically. */
  onState: (state: ConnectionState, reconnecting: boolean) => void;
  onTransport: (connection: DaemonConnection | null) => void;
  onWorkspace: (snapshot: WorkspaceSnapshot) => void;
  isOnline?: () => boolean;
}

/** A connection that stayed up this long dropped for an external reason (e.g. token expiry). */
const STABLE_MS = 5_000;
/** The OS "offline" signal is only a hint; the socket must also go quiet this long. */
const OFFLINE_SILENCE_MS = 10_000;
/** Renew access this long before the token expires, retrying on failure until it does. */
const REFRESH_LEAD_MS = 2 * 60_000;
const REFRESH_RETRY_MS = 30_000;

/**
 * One selected host's lifetime. The same `DaemonConnection` is reused across reconnects so
 * subscribers (and what they show) survive a drop. Tokens stay in memory; each socket gets a
 * fresh token.
 */
export function connectHost(options: HostConnectionOptions) {
  let disposed = false;
  let blocked = false;
  let authRetried = false;
  let generation = 0;
  let delay = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let tokenExpiresAt: number | null = null;
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  let readySince: number | null = null;
  let established = false;
  let quiet = false;
  const managed = options.machineId !== "local";
  const connection = new DaemonConnection(options);

  function report(state: ConnectionState) {
    options.onState(state, established && !blocked && state.status !== "ready");
  }
  function drop() {
    generation++;
    clearTimeout(timer);
    clearTimeout(refreshTimer);
    quiet = true;
    connection.disconnect();
    quiet = false;
  }
  function stop(message: string) {
    blocked = true;
    drop();
    report({ status: "error", error: { code: "INTERNAL_ERROR", message } });
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
    // A long-lived connection that drops (e.g. the gateway expiring its token) comes straight
    // back; only repeated failures back off.
    const stable = readySince !== null && Date.now() - readySince >= STABLE_MS;
    readySince = null;
    clearTimeout(timer);
    timer = setTimeout(() => void attempt(), authentication || opaque || stable ? 0 : delay);
    if (!authentication && !opaque && !stable) delay = Math.min(delay * 2, 30_000);
  }
  async function attempt() {
    if (disposed || blocked) return;
    drop();
    const attemptGeneration = generation;
    report({ status: "connecting" });
    let protocols: string[] | undefined;
    try {
      if (managed) {
        const { token } = await options.api.mintMachineToken(options.machineId);
        protocols = [`concors.bearer.${token}`];
        tokenExpiresAt = tokenExpiry(token);
      }
    } catch (error) {
      if (disposed || attemptGeneration !== generation) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        stop("Access revoked");
        return;
      }
      report({
        status: "error",
        error: { code: "INTERNAL_ERROR", message: "Could not authorize this machine" },
      });
      retry(error instanceof ApiError && error.status === 401);
      return;
    }
    if (disposed || attemptGeneration !== generation) return;
    await connection.connect(protocols).catch(() => undefined); // The subscription owns retries.
  }

  /**
   * A managed gateway cuts the socket when its token expires. Where it accepts renewal in place,
   * hand it a fresh token first so the connection never drops for routine token rotation.
   */
  function scheduleRefresh(delay?: number) {
    clearTimeout(refreshTimer);
    if (!managed || tokenExpiresAt === null || !connection.canRefreshAuthorization) return;
    const deadline = tokenExpiresAt;
    const scheduled = generation;
    refreshTimer = setTimeout(
      () => (expired() ? restore() : void renew()),
      delay ?? Math.max(0, deadline - REFRESH_LEAD_MS - Date.now()),
    );
    async function renew() {
      let renewed = false;
      try {
        const { token } = await options.api.mintMachineToken(options.machineId);
        if (disposed || scheduled !== generation) return;
        renewed = await connection.refreshAuthorization(token);
        if (renewed) tokenExpiresAt = tokenExpiry(token);
      } catch {
        // Try again shortly; if access is really gone the socket expires and reconnects.
      }
      if (disposed || scheduled !== generation) return;
      if (renewed) scheduleRefresh();
      else if (deadline - Date.now() > REFRESH_RETRY_MS) scheduleRefresh(REFRESH_RETRY_MS);
    }
  }

  /** Timers can fire late (sleep, App Nap); past its token's expiry the gateway has cut the socket. */
  function expired() {
    return (
      managed &&
      tokenExpiresAt !== null &&
      connection.state.status === "ready" &&
      Date.now() >= tokenExpiresAt
    );
  }
  /** Replaces a socket that is gone even if no close arrived; a sleeping device never hears it. */
  function restore() {
    drop();
    report({ status: "disconnected", reason: "Access expired before it could be renewed" });
    readySince = null;
    void attempt();
  }

  options.onTransport(connection);
  const unsubscribeWorkspace = connection.subscribeWorkspace(options.onWorkspace);
  const unsubscribe = connection.subscribe((state) => {
    if (disposed || quiet) return;
    if (state.status === "ready") {
      delay = 1_000;
      readySince = Date.now();
      established = true;
      // A successful authenticated handshake ends this retry episode. Later token expiry
      // gets its own refresh, so a healthy session can outlive multiple 15-minute tokens.
      authRetried = false;
      scheduleRefresh();
    } else clearTimeout(refreshTimer);
    report(state);
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
  void attempt();
  return {
    // An explicit user retry starts a new authorization attempt; network events cannot unblock it.
    reconnect: () => {
      blocked = false;
      authRetried = false;
      delay = 1_000;
      void attempt();
    },
    /** The OS reports connectivity again: skip any backoff, but never replace a live socket. */
    resume: () => {
      clearTimeout(offlineTimer);
      if (!blocked && connection.state.status !== "ready") void attempt();
    },
    /**
     * The app is back in front or the device woke. Timers may have been held back meanwhile, so
     * catch up now: replace a socket whose access lapsed, renew one about to, skip any backoff.
     */
    wake: () => {
      if (disposed || blocked) return;
      const status = connection.state.status;
      if (status === "disconnected" || status === "error") {
        clearTimeout(timer);
        void attempt();
      } else if (expired()) restore();
      else if (
        managed &&
        status === "ready" &&
        tokenExpiresAt !== null &&
        Date.now() >= tokenExpiresAt - REFRESH_LEAD_MS
      )
        scheduleRefresh(0);
    },
    /**
     * OS offline events fire on any interface change (VPN, Wi-Fi roaming), so a healthy socket
     * is kept. It is only replaced if nothing arrives on it while the device stays offline.
     */
    offline: () => {
      if (options.endpoint.kind === "local" || blocked) return;
      clearTimeout(offlineTimer);
      const since = Date.now();
      offlineTimer = setTimeout(() => {
        if (disposed || blocked || options.isOnline?.() !== false) return;
        if (connection.state.status === "ready" && connection.lastMessageAt < since) {
          drop();
          report({ status: "disconnected", reason: "Device is offline" });
          retry(false);
        }
      }, OFFLINE_SILENCE_MS);
    },
    dispose: () => {
      disposed = true;
      clearTimeout(offlineTimer);
      clearTimeout(refreshTimer);
      unsubscribe();
      unsubscribeWorkspace();
      drop();
      options.onTransport(null);
    },
  };
}

/** Reads `exp` without verifying: only used to time renewal, never to grant access. */
function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
