import { HEALTH_PATH, type HealthResponse } from "@concors/protocol";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { DaemonConfig } from "./config.ts";
import { DaemonState } from "./state.ts";
import { registerProtocolEndpoint } from "./ws/protocol-endpoint.ts";

export interface DaemonServerOptions {
  /** Overrides for tests; production always uses the defaults. */
  readonly handshakeTimeoutMs?: number;
}

export interface DaemonServer {
  readonly app: FastifyInstance;
  readonly state: DaemonState;
  /** Starts listening. Resolves with the bound URL (useful when `port` is `0`). */
  listen(): Promise<string>;
  /** Closes client connections and the HTTP server. Idempotent. */
  close(): Promise<void>;
}

/**
 * Assembles the daemon's HTTP + WebSocket server.
 *
 * The daemon is a plain Node process with no knowledge of Tauri or any client: the same server
 * runs as a bundled sidecar on a laptop and as a systemd service on a VPS.
 */
export function createDaemonServer(
  config: DaemonConfig,
  options: DaemonServerOptions = {},
): DaemonServer {
  const state = new DaemonState();

  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    // Request IDs make WebSocket connection logs traceable without extra dependencies.
    genReqId: () => crypto.randomUUID(),
  });

  let closeConnections: () => void = () => undefined;

  app.register(websocket, {
    options: {
      // Handshake messages are small; agent output will be streamed in frames well below this.
      maxPayload: 1024 * 1024,
    },
  });

  app.register(async (instance) => {
    closeConnections = registerProtocolEndpoint(instance, {
      state,
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    });
  });

  app.get(HEALTH_PATH, async (): Promise<HealthResponse> => ({ status: "ok" }));

  let closing: Promise<void> | null = null;

  return {
    app,
    state,

    async listen(): Promise<string> {
      const url = await app.listen({ host: config.host, port: config.port });
      state.status = "ready";
      return url;
    },

    close(): Promise<void> {
      closing ??= (async () => {
        state.status = "shutting_down";
        closeConnections();
        await app.close();
      })();
      return closing;
    },
  };
}
