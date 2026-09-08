import type { AgentProviderFactory } from "./agents/manager.ts";
import { timingSafeEqual } from "node:crypto";
import { HEALTH_PATH, type HealthResponse } from "@concors/protocol";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { DaemonConfig } from "./config.ts";
import { WorkspaceStore } from "./workspace/store.ts";
import { DaemonState } from "./state.ts";
import { registerProtocolEndpoint } from "./ws/protocol-endpoint.ts";

export interface DaemonServerOptions {
  /** Private session hosts accept only their local gateway's credential. */
  readonly internalToken?: string;
  readonly agentProviderFactory?: AgentProviderFactory;
  /** Overrides for tests; production always uses the defaults. */
  readonly handshakeTimeoutMs?: number;
  /** In-memory by default for embedded/test servers. The CLI supplies a durable file. */
  readonly workspacePath?: string;
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
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error(
      "Terminal-enabled daemons must bind to loopback until authenticated remote access is configured. Use an SSH tunnel for remote development.",
    );
  const state = new DaemonState();
  const workspace = new WorkspaceStore(options.workspacePath);

  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    // Request IDs make WebSocket connection logs traceable without extra dependencies.
    genReqId: () => crypto.randomUUID(),
  });
  if (options.internalToken) {
    const expected = Buffer.from(`Bearer ${options.internalToken}`);
    app.addHook("onRequest", async (request, reply) => {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply.code(401).send({ error: "Unauthorized" });
    });
  }

  let closeConnections: () => Promise<void> = async () => undefined;

  app.register(websocket, {
    options: {
      // Handshake messages are small; agent output will be streamed in frames well below this.
      maxPayload: 8 * 1024 * 1024,
    },
  });

  app.register(async (instance) => {
    closeConnections = registerProtocolEndpoint(instance, {
      state,
      workspace,
      ...(options.agentProviderFactory
        ? { agentProviderFactory: options.agentProviderFactory }
        : {}),
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    });
  });

  app.get(HEALTH_PATH, async (): Promise<HealthResponse> => ({ status: "ok" }));

  app.addHook("onClose", () => {
    workspace.close();
  });

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
        await closeConnections();
        await app.close();
      })();
      return closing;
    },
  };
}
