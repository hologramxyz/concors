import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createTlsServer } from "node:https";
import type { Duplex } from "node:stream";
import {
  bearerProtocol,
  tokenFromRequest,
  type Principal,
  type TokenVerifier,
} from "../managed/auth.ts";
import type { ManagedConfig, TlsMaterial } from "../managed/config.ts";
import type { Logger } from "../managed/log.ts";
import { collectMachineResources } from "../managed/resources.ts";
import { createHeartbeat } from "../managed/heartbeat.ts";
import { countHostSessions } from "../managed/sessions.ts";
import { DAEMON_VERSION } from "../version.ts";
import type { Socket } from "node:net";
import type { DaemonConfig } from "../config.ts";
import { ensureSessionHost, type HostDescriptor, type HostLaunch } from "./session-host.ts";

export interface ManagedGatewayOptions {
  config: ManagedConfig;
  verifier: TokenVerifier;
  logger: Logger;
  /** Omitted only by tests. The CLI always loads the TLS pair before constructing a gateway. */
  tls?: TlsMaterial;
  heartbeatFetch?: typeof fetch;
}

/** Restartable transport only. The detached host is the sole owner of sessions and SQLite. */
export function createPersistentGateway(
  config: DaemonConfig,
  directory: string,
  launch: HostLaunch,
  managed?: ManagedGatewayOptions,
) {
  if (!managed && !["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error(
      "Session gateways must bind to loopback. Use an authenticated tunnel for remote access.",
    );
  let pending: Promise<HostDescriptor> | null = null;
  let closing = false;
  const sockets = new Set<Socket>();
  const host = () =>
    (pending ??= ensureSessionHost(directory, launch).finally(() => {
      pending = null;
    }));
  const heartbeat = managed
    ? createHeartbeat({
        ...managed.config,
        version: DAEMON_VERSION,
        collectResources: collectMachineResources,
        countSessions: async () => countHostSessions(await host()),
        logger: managed.logger,
        ...(managed.heartbeatFetch ? { fetchImpl: managed.heartbeatFetch } : {}),
      })
    : undefined;
  const bindHost = managed ? "0.0.0.0" : config.host;
  const bindPort = managed ? managed.config.port : config.port;

  async function authenticate(req: IncomingMessage): Promise<Principal> {
    const token = tokenFromRequest(req);
    if (!token || !managed) throw new Error("Unauthorized");
    const principal = await managed.verifier.verify(token);
    if (!Number.isFinite(principal.expiresAt) || principal.expiresAt <= Date.now())
      throw new Error("Unauthorized");
    return principal;
  }
  function ownHost(req: IncomingMessage): boolean {
    const header = req.headers.host?.toLowerCase();
    const hostname = managed?.config.hostname;
    return (
      hostname !== undefined &&
      (header === hostname || header === `${hostname}:${req.socket.localPort}`)
    );
  }
  function logConnection(
    principal: Principal,
    connection: IncomingMessage | Duplex | ServerResponse,
  ) {
    const fields = { sub: principal.userId, sid: principal.sessionId };
    managed?.logger.info(fields, "managed client connected");
    connection.once("close", () => managed?.logger.info(fields, "managed client disconnected"));
  }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (managed) {
      let principal: Principal | undefined;
      if (req.method !== "GET" || req.url !== "/health") {
        try {
          principal = await authenticate(req);
        } catch {
          res.writeHead(401).end();
          return;
        }
      }
      if (!ownHost(req)) {
        res.writeHead(403).end();
        return;
      }
      if (principal) {
        const expiry = setTimeout(
          () => res.destroy(),
          Math.max(0, principal.expiresAt - Date.now()),
        );
        expiry.unref();
        res.once("close", () => clearTimeout(expiry));
        let path: string;
        try {
          path = publicPath(req);
        } catch {
          res.writeHead(404).end();
          return;
        }
        if (closing || req.destroyed || res.destroyed) {
          res.writeHead(503).end();
          return;
        }
        try {
          const runtime = await host();
          if (closing || res.destroyed) return;
          logConnection(principal, res);
          const upstream = httpRequest(
            {
              host: "127.0.0.1",
              port: runtime.port,
              path,
              method: req.method,
              headers: managedHeaders(req, runtime),
            },
            (response) => {
              const headers = { ...response.headers };
              delete headers["x-concors-host"];
              res.writeHead(response.statusCode ?? 502, headers);
              response.on("error", () => res.destroy());
              response.pipe(res);
            },
          );
          upstream.setTimeout(5000, () => upstream.destroy());
          upstream.on("error", () => {
            if (!res.headersSent) res.writeHead(502).end();
            else res.destroy();
          });
          res.once("close", () => upstream.destroy());
          req.on("error", () => upstream.destroy());
          if (req.headers.expect === "100-continue") res.writeContinue();
          req.pipe(upstream);
        } catch {
          res.writeHead(503).end();
        }
        return;
      }
    }
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    try {
      await host();
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok", ...(managed ? { version: DAEMON_VERSION } : {}) }));
    } catch {
      res.writeHead(503, { "content-type": "application/json" }).end(
        JSON.stringify({
          status: "reconnecting",
          ...(managed ? { version: DAEMON_VERSION } : {}),
        }),
      );
    }
  };
  const server = managed?.tls ? createTlsServer(managed.tls, handle) : createServer(handle);
  // Node otherwise sends 100 Continue before the request handler can authenticate it.
  if (managed) {
    server.on("checkContinue", handle);
    server.on("checkExpectation", handle);
  }
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, downstream, head) => {
    downstream.on("error", () => downstream.destroy());
    void upgrade(req, downstream, head).catch(() => downstream.destroy());
  });
  async function upgrade(req: IncomingMessage, downstream: Duplex, head: Buffer) {
    let principal: Principal | undefined;
    if (managed) {
      downstream.pause();
      try {
        principal = await authenticate(req);
      } catch {
        rejectUpgrade(downstream, 401);
        return;
      }
      if (!ownHost(req)) {
        rejectUpgrade(downstream, 403);
        return;
      }
      // The private host owns the sessions. Expiring this network socket detaches the
      // device without stopping terminals/agents; a reconnect must mint fresh access.
      // Destroy the stream rather than injecting a WS frame into possibly partial frames.
      const expiry = setTimeout(
        () => downstream.destroy(),
        Math.max(0, principal.expiresAt - Date.now()),
      );
      expiry.unref();
      downstream.once("close", () => clearTimeout(expiry));
    }
    if (
      (managed ? new URL(req.url ?? "/", "http://daemon").pathname !== "/ws" : req.url !== "/ws") ||
      closing
    ) {
      downstream.destroy();
      return;
    }
    downstream.pause();
    void host()
      .then((runtime) => {
        if (closing || downstream.destroyed) return;
        const upstream = httpRequest({
          host: "127.0.0.1",
          port: runtime.port,
          path: "/ws",
          method: "GET",
          headers: managed
            ? managedHeaders(req, runtime)
            : {
                ...req.headers,
                host: `127.0.0.1:${runtime.port}`,
                authorization: `Bearer ${runtime.token}`,
              },
        });
        const timer = setTimeout(
          () => upstream.destroy(new Error("Session host connection timed out")),
          5000,
        );
        downstream.once("close", () => upstream.destroy());
        upstream.on("error", () => {
          clearTimeout(timer);
          downstream.destroy();
        });
        upstream.on("response", (response) => {
          clearTimeout(timer);
          response.resume();
          downstream.destroy();
        });
        upstream.on("upgrade", (response, socket, upstreamHead) => {
          clearTimeout(timer);
          if (closing || downstream.destroyed) {
            socket.destroy();
            return;
          }
          sockets.add(socket);
          socket.on("close", () => {
            sockets.delete(socket);
            downstream.destroy();
          });
          socket.on("error", () => downstream.destroy());
          downstream.on("error", () => socket.destroy());
          downstream.once("close", () => socket.destroy());
          const headers = response.rawHeaders.reduce<string[]>((result, value, index, all) => {
            if (
              index % 2 === 0 &&
              value.toLowerCase() !== "x-concors-host" &&
              !(managed && value.toLowerCase() === "sec-websocket-protocol")
            )
              result.push(`${value}: ${all[index + 1]}`);
            return result;
          }, []);
          if (managed && principal) {
            const protocol = bearerProtocol(req);
            if (protocol) headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            logConnection(principal, downstream);
          }
          downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
          if (upstreamHead.length) downstream.write(upstreamHead);
          if (head.length) socket.write(head);
          // Stream backpressure bounds buffering, including while the client is temporarily slow.
          downstream.pipe(socket).pipe(downstream);
          downstream.resume();
        });
        upstream.end();
      })
      .catch(() => downstream.destroy());
  }
  return {
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(bindPort, bindHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
      try {
        await host();
      } catch (error) {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        throw error;
      }
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Gateway did not start");
      heartbeat?.start();
      const hostname = managed ? managed.config.hostname : config.host;
      return `${managed?.tls ? "https" : "http"}://${hostname.includes(":") ? `[${hostname}]` : hostname}:${address.port}`;
    },
    async close(): Promise<void> {
      closing = true;
      heartbeat?.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/** Machine credentials and browser origins terminate here, before the private host. */
function managedHeaders(req: IncomingMessage, runtime: HostDescriptor) {
  const headers: Record<string, string | string[]> = {
    host: `127.0.0.1:${runtime.port}`,
    authorization: `Bearer ${runtime.token}`,
  };
  for (const name of [
    "content-type",
    "content-length",
    "accept",
    "upgrade",
    "connection",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-extensions",
  ]) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

function publicPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://daemon");
  // Never expose the session host's maintenance API using its private credential.
  const decoded = new URL(decodeURIComponent(url.pathname), "http://daemon").pathname;
  if (decoded === "/internal" || decoded.startsWith("/internal/")) throw new Error("Private route");
  url.searchParams.delete("token");
  return url.pathname + url.search;
}

function rejectUpgrade(socket: Duplex, status: 401 | 403) {
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  const timer = setTimeout(() => socket.destroy(), 1000);
  timer.unref();
  socket.once("close", () => clearTimeout(timer));
}
