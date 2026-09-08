import { createServer, request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import type { DaemonConfig } from "../config.ts";
import { ensureSessionHost, type HostDescriptor, type HostLaunch } from "./session-host.ts";

/** Restartable transport only. The detached host is the sole owner of sessions and SQLite. */
export function createPersistentGateway(
  config: DaemonConfig,
  directory: string,
  launch: HostLaunch,
) {
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host))
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
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    try {
      await host();
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
    } catch {
      res
        .writeHead(503, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "reconnecting" }));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, downstream, head) => {
    if (req.url !== "/ws" || closing) {
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
          headers: {
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
            if (index % 2 === 0 && value.toLowerCase() !== "x-concors-host")
              result.push(`${value}: ${all[index + 1]}`);
            return result;
          }, []);
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
  });
  return {
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
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
      return `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${address.port}`;
    },
    async close(): Promise<void> {
      closing = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
