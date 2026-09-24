import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  AUTH_REFRESH_CAPABILITY,
  AuthRefreshMessageSchema,
  type AuthRefreshedMessage,
} from "@concors/protocol";
import { bearerProtocol, type Principal, type TokenVerifier } from "../managed/auth.ts";

/** Stop reading from the host while this much is still queued for a slow client. */
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;
/** A client told its access expired gets this long to close before the socket is cut. */
const CLOSE_GRACE_MS = 1_000;
const EXPIRED = 4401;

const server = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  perMessageDeflate: false,
  // The browser offers its bearer token as a subprotocol and requires it to be echoed.
  handleProtocols: (_protocols, req) => bearerProtocol(req) ?? false,
});

export interface ManagedRelayOptions {
  req: IncomingMessage;
  downstream: Duplex;
  head: Buffer;
  host: { port: number; token: string };
  principal: Principal;
  verifier: TokenVerifier;
  /** Lets the gateway cut the private socket on shutdown. */
  track: (socket: Socket) => void;
  onConnected: () => void;
}

/**
 * Relays one authenticated device socket to the private session host message by message. Unlike
 * a byte pipe this can close an expired socket with a proper 4401 frame, and it accepts
 * `auth.refresh` so a client renews access on the live socket instead of reconnecting.
 */
export function relayManagedSocket(options: ManagedRelayOptions): void {
  const { req, downstream, principal } = options;
  const upstream = new WebSocket(`ws://127.0.0.1:${options.host.port}/ws`, {
    headers: { authorization: `Bearer ${options.host.token}` },
    perMessageDeflate: false,
    handshakeTimeout: 5000,
  });
  let client: WebSocket | null = null;
  downstream.once("close", () => upstream.terminate());
  upstream.on("error", () => {
    downstream.destroy();
    client?.terminate();
  });
  upstream.on("unexpected-response", (_request, response) => {
    response.resume();
    upstream.terminate();
    downstream.destroy();
  });
  upstream.on("upgrade", (response) => options.track(response.socket as Socket));
  upstream.once("open", () => {
    if (downstream.destroyed) {
      upstream.terminate();
      return;
    }
    server.handleUpgrade(req, downstream as Socket, options.head, (socket) => {
      client = socket;
      options.onConnected();
      bridge(socket, upstream, principal, options.verifier);
    });
    // The gateway paused the socket while it authenticated and found the host.
    downstream.resume();
  });
}

function bridge(
  client: WebSocket,
  upstream: WebSocket,
  principal: Principal,
  verifier: TokenVerifier,
) {
  let expiresAt = principal.expiresAt;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let advertised = false;
  let refreshing = false;
  let paused = false;
  const arm = () => {
    clearTimeout(expiry);
    expiry = setTimeout(
      () => {
        // The private host owns the sessions; detaching this device leaves them running.
        client.close(EXPIRED, "Access expired");
        upstream.close(1000, "Access expired");
        setTimeout(() => client.terminate(), CLOSE_GRACE_MS).unref();
      },
      Math.max(0, expiresAt - Date.now()),
    );
    expiry.unref();
  };
  arm();

  const drained = () => {
    if (paused && client.bufferedAmount < LOW_WATER) {
      paused = false;
      upstream.resume();
    }
  };
  upstream.on("message", (data, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return;
    let payload: RawData | string = data;
    if (!advertised && !isBinary) {
      const ready = advertise(data);
      if (ready) {
        advertised = true;
        payload = ready;
      }
    }
    client.send(payload, { binary: isBinary }, drained);
    if (!paused && client.bufferedAmount > HIGH_WATER) {
      paused = true;
      upstream.pause();
    }
  });
  client.on("message", (data, isBinary) => {
    if (!isBinary && isRefresh(data)) {
      void refresh(data);
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });

  async function refresh(data: RawData) {
    if (refreshing) return;
    refreshing = true;
    let reply: AuthRefreshedMessage = { type: "auth.refreshed", ok: false };
    try {
      const message = AuthRefreshMessageSchema.parse(JSON.parse(text(data)));
      const next = await verifier.verify(message.token);
      // A socket may only be renewed for the same person and device it was opened for.
      if (
        next.userId === principal.userId &&
        next.sessionId === principal.sessionId &&
        next.organizationId === principal.organizationId &&
        next.expiresAt > Date.now()
      ) {
        expiresAt = Math.max(expiresAt, next.expiresAt);
        arm();
        reply = { type: "auth.refreshed", ok: true, expiresAt };
      }
    } catch {
      // An unusable token leaves the current deadline in place.
    } finally {
      refreshing = false;
    }
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(reply));
  }

  const done = () => clearTimeout(expiry);
  upstream.on("close", (code, reason) => {
    done();
    forwardClose(client, code, reason);
  });
  client.on("close", (code, reason) => {
    done();
    forwardClose(upstream, code, reason);
  });
  upstream.on("error", () => client.terminate());
  client.on("error", () => upstream.terminate());
}

/** Adds the refresh capability to the host's `daemon.ready`; other messages pass untouched. */
function advertise(data: RawData): string | null {
  const raw = text(data);
  if (!raw.includes('"daemon.ready"')) return null;
  try {
    const message = JSON.parse(raw) as { type?: unknown; capabilities?: unknown };
    if (message.type !== "daemon.ready") return null;
    const capabilities = Array.isArray(message.capabilities) ? message.capabilities : [];
    return JSON.stringify({ ...message, capabilities: [...capabilities, AUTH_REFRESH_CAPABILITY] });
  } catch {
    return null;
  }
}

/** Only the start is inspected, so large relayed messages (e.g. dictation audio) stay cheap. */
function isRefresh(data: RawData): boolean {
  const message = buffer(data);
  return (
    message.length <= 16_384 &&
    /^\s*\{\s*"type"\s*:\s*"auth\.refresh"/.test(message.subarray(0, 64).toString("utf8"))
  );
}

function text(data: RawData): string {
  return buffer(data).toString("utf8");
}

/** `ws` delivers Buffers by default; the other shapes only occur with a non-default binaryType. */
function buffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

function forwardClose(target: WebSocket, code: number, reason: Buffer) {
  if (target.readyState === WebSocket.CLOSED || target.readyState === WebSocket.CLOSING) return;
  // 1005/1006/1015 describe the socket, not a sendable status; mirror them as an abrupt drop.
  const sendable =
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999);
  if (sendable) target.close(code, reason.toString("utf8").slice(0, 60));
  else target.terminate();
}
