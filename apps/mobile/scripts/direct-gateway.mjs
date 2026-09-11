import { createServer, request } from "node:http";

/** Private development adapter, not a public/cloud gateway. Put Tailscale Serve in front.
 * Trust identity headers only on loopback: https://tailscale.com/docs/features/tailscale-serve#identity-headers
 * No credentials go to the daemon. Optional profile sign-in forwards only three exact
 * account routes to an operator-configured HTTPS API; no generic proxy or origin wildcard.
 */
export function createDirectGateway({
  daemonPort,
  origin,
  allowedUser,
  profileApiUrl,
  profileFetch = fetch,
}) {
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))
  )
    throw new Error("Configure an exact HTTPS preview origin (HTTP loopback for tests only).");
  if (!allowedUser || !/^[\x21-\x7e]+$/.test(allowedUser))
    throw new Error("Configure one allowed Tailscale login.");
  if (!Number.isInteger(daemonPort) || daemonPort < 1 || daemonPort > 65535)
    throw new Error("Invalid loopback daemon port.");
  const profileOrigin = profileApiUrl ? new URL(profileApiUrl) : null;
  if (
    profileOrigin &&
    (profileOrigin.protocol !== "https:" || profileOrigin.origin !== profileApiUrl)
  )
    throw new Error("Profile API must be an exact HTTPS origin without credentials or paths.");
  const profileRoutes = new Map([
    ["/api/auth/sign-in/email", "POST"],
    ["/api/auth/sign-out", "POST"],
    ["/api/v1/me", "GET"],
  ]);
  const profileRequest = async (req, res, path) => {
    if (!profileOrigin || profileRoutes.get(path) !== req.method) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "POST" && req.headers["content-type"] !== "application/json") {
      res.writeHead(415).end();
      return;
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16_384) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const response = await profileFetch(profileOrigin.origin + path, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          origin: profileOrigin.origin,
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      // Never forward account cookies or redirect targets onto the shared preview origin.
      const data = await response.text();
      if (data.length > 1_000_000) throw new Error("Oversized account response");
      res
        .writeHead(response.status, {
          "content-type": "application/json",
          ...(response.headers.get("set-auth-token")
            ? { "set-auth-token": response.headers.get("set-auth-token") }
            : {}),
        })
        .end(data);
    } catch {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Concourse profile service unavailable." }));
    }
  };
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    return socket;
  };
  const authorized = (req) =>
    req.headers["tailscale-user-login"] === allowedUser &&
    (!req.headers.origin || req.headers.origin === origin);
  const isPath = (raw, path) => raw === path || raw === `/desktop-daemon${path}`;
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    if (!authorized(req)) {
      res.writeHead(403).end("Private Tailscale identity required.");
      return;
    }
    const profilePrefix = ["/profile-api", "/desktop-daemon/profile-api"].find((prefix) =>
      req.url?.startsWith(prefix + "/"),
    );
    if (profilePrefix) {
      void profileRequest(req, res, req.url.slice(profilePrefix.length));
      return;
    }
    if (req.method !== "GET" || !isPath(req.url, "/health")) {
      res.writeHead(404).end();
      return;
    }
    const upstream = request(
      { host: "127.0.0.1", port: daemonPort, path: "/health", timeout: 5000 },
      (response) => {
        response.resume();
        const ok = response.statusCode === 200;
        res
          .writeHead(ok ? 200 : 503, { "content-type": "application/json" })
          .end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Desktop daemon unavailable.");
    });
    res.on("close", () => upstream.destroy());
    upstream.end();
  });
  server.on("connection", track);
  server.on("upgrade", (req, downstream, head) => {
    const reject = (status) => downstream.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (!authorized(req)) {
      reject("403 Forbidden");
      return;
    }
    if (!isPath(req.url, "/ws") || req.method !== "GET") {
      reject("404 Not Found");
      return;
    }
    if (
      req.headers["sec-websocket-version"] !== "13" ||
      !req.headers["sec-websocket-key"] ||
      (req.headers["sec-websocket-protocol"] &&
        req.headers["sec-websocket-protocol"] !== "concors.v1")
    ) {
      reject("400 Bad Request");
      return;
    }
    downstream.pause();
    // Only after authenticating the private request, adapt it to the daemon's local UI origin.
    const upstream = request({
      host: "127.0.0.1",
      port: daemonPort,
      path: "/ws",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        origin: "http://localhost:1420",
        "sec-websocket-key": req.headers["sec-websocket-key"],
        "sec-websocket-version": "13",
        ...(req.headers["sec-websocket-protocol"]
          ? { "sec-websocket-protocol": "concors.v1" }
          : {}),
      },
    });
    const timer = setTimeout(() => upstream.destroy(), 5000);
    downstream.once("close", () => upstream.destroy());
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => {
      clearTimeout(timer);
      downstream.destroy();
    });
    upstream.on("response", (response) => {
      clearTimeout(timer);
      response.resume();
      reject("502 Bad Gateway");
    });
    upstream.on("upgrade", (response, socket, upstreamHead) => {
      clearTimeout(timer);
      if (downstream.destroyed) {
        socket.destroy();
        return;
      }
      track(socket);
      socket.on("error", () => downstream.destroy());
      socket.once("close", () => downstream.destroy());
      downstream.once("close", () => socket.destroy());
      const accept = response.headers["sec-websocket-accept"];
      downstream.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${response.headers["sec-websocket-protocol"] === "concors.v1" ? "Sec-WebSocket-Protocol: concors.v1\r\n" : ""}\r\n`,
      );
      if (upstreamHead.length) downstream.write(upstreamHead);
      if (head.length) socket.write(head);
      downstream.pipe(socket).pipe(downstream);
      downstream.resume();
    });
    upstream.end();
  });
  return {
    async listen(port = 0) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address().port;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

if (import.meta.main) {
  const gateway = createDirectGateway({
    daemonPort: Number(process.env.CONCORS_DIRECT_DAEMON_PORT ?? 7420),
    origin: process.env.CONCORS_DIRECT_GATEWAY_ORIGIN,
    allowedUser: process.env.CONCORS_DIRECT_GATEWAY_USER,
    profileApiUrl: process.env.CONCORS_DIRECT_PROFILE_API_URL,
  });
  const port = await gateway.listen(Number(process.env.CONCORS_DIRECT_GATEWAY_PORT ?? 7444));
  process.stdout.write(`Private desktop adapter listening on 127.0.0.1:${port}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void gateway.close());
}
