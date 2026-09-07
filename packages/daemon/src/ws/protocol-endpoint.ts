import {
  PROTOCOL_VERSIONS,
  WS_PATH,
  createProtocolError,
  parseClientMessage,
  type ClientMessage,
  type DaemonMessage,
  type ProtocolError,
} from "@concors/protocol";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

import type { DaemonState } from "../state.ts";

export interface ProtocolEndpointOptions {
  readonly state: DaemonState;
  /** How long a freshly-opened socket may stay silent before we drop it. */
  readonly handshakeTimeoutMs?: number;
}

/** WebSocket close codes used by the daemon. 1002 = protocol error, 1001 = going away. */
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_GOING_AWAY = 1001;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Mounts the Concors protocol WebSocket endpoint.
 *
 * Every connection goes through the handshake defined in `@concors/protocol`:
 *
 *   client.hello  →  validate  →  daemon.ready | error (+ close)
 *
 * Nothing beyond the handshake is implemented yet. Post-handshake messages are answered with a
 * structured error so clients get feedback instead of silence. Returns a function that closes
 * every open connection, used during graceful shutdown.
 */
export function registerProtocolEndpoint(
  app: FastifyInstance,
  options: ProtocolEndpointOptions,
): () => void {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const connections = new Set<WebSocket>();

  app.get(WS_PATH, { websocket: true }, (socket, request) => {
    const log = request.log.child({ connection: request.id });
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));

    void new ConnectionHandler(socket, log, options.state, handshakeTimeoutMs).run();
  });

  return () => {
    for (const socket of connections) {
      socket.close(CLOSE_GOING_AWAY, "daemon shutting down");
    }
    connections.clear();
  };
}

class ConnectionHandler {
  #handshakeComplete = false;
  private readonly socket: WebSocket;
  private readonly log: FastifyBaseLogger;
  private readonly state: DaemonState;
  private readonly handshakeTimeoutMs: number;

  constructor(
    socket: WebSocket,
    log: FastifyBaseLogger,
    state: DaemonState,
    handshakeTimeoutMs: number,
  ) {
    this.socket = socket;
    this.log = log;
    this.state = state;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
  }

  run(): void {
    const handshakeTimer = setTimeout(() => {
      if (!this.#handshakeComplete) {
        this.fail(
          createProtocolError(
            "HANDSHAKE_TIMEOUT",
            `No client.hello received within ${this.handshakeTimeoutMs}ms`,
          ),
        );
      }
    }, this.handshakeTimeoutMs);

    this.socket.on("message", (data) => {
      const decoded = decodeJson(data.toString());

      // Checked before schema validation so a newer/older client gets a precise error rather
      // than a generic validation failure.
      const unsupported = unsupportedProtocolVersion(decoded);
      if (unsupported !== null) {
        this.fail(
          createProtocolError(
            "PROTOCOL_VERSION_UNSUPPORTED",
            `Protocol version "${unsupported}" is not supported by this daemon`,
            { supported: PROTOCOL_VERSIONS },
          ),
        );
        return;
      }

      const parsed = parseClientMessage(decoded);
      if (!parsed.success) {
        const error = createProtocolError("INVALID_MESSAGE", "Message failed validation", {
          issues: parsed.error.issues,
        });
        if (this.#handshakeComplete) {
          this.send({ type: "error", error });
        } else {
          this.fail(error);
        }
        return;
      }
      this.handle(parsed.data);
    });

    this.socket.on("close", () => clearTimeout(handshakeTimer));
    this.socket.on("error", (err) => this.log.warn({ err }, "websocket error"));
  }

  private handle(message: ClientMessage): void {
    switch (message.type) {
      case "client.hello": {
        if (this.#handshakeComplete) {
          this.send({
            type: "error",
            error: createProtocolError("INVALID_MESSAGE", "Handshake already completed"),
          });
          return;
        }
        this.#handshakeComplete = true;
        this.log.info(
          { client: message.client, protocolVersion: message.protocolVersion },
          "client connected",
        );
        this.send({ type: "daemon.ready", ...this.state.info() });
        return;
      }
    }
  }

  private send(message: DaemonMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Sends a structured error and closes the socket. Used for unrecoverable handshake failures. */
  private fail(error: ProtocolError): void {
    this.log.warn({ code: error.code }, error.message);
    this.send({ type: "error", error });
    this.socket.close(CLOSE_PROTOCOL_ERROR, error.code);
  }
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // fails schema validation downstream with a clear issue
  }
}

/** Returns the requested protocol version if it is one this daemon does not speak, else `null`. */
function unsupportedProtocolVersion(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, protocolVersion } = value as Record<string, unknown>;
  if (type !== "client.hello" || typeof protocolVersion !== "string") return null;
  return (PROTOCOL_VERSIONS as readonly string[]).includes(protocolVersion)
    ? null
    : protocolVersion;
}
