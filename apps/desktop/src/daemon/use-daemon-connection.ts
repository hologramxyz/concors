import {
  DaemonConnection,
  type ConnectionState,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import type { ClientInfo } from "@concors/protocol";
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
  const retryNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (endpoint === null) return;

    let disposed = false;
    let retryDelay = INITIAL_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connection: DaemonConnection | null = null;
    let unsubscribe: () => void = () => undefined;

    const dropCurrent = (): void => {
      // Unsubscribe first so the resulting "disconnected" event does not schedule a retry.
      unsubscribe();
      unsubscribe = () => undefined;
      connection?.disconnect();
      connection = null;
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
      unsubscribe = next.subscribe((s) => {
        setState(s);
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

  return { state, reconnectNow: () => retryNow.current() };
}
