import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createDirectGateway } from "./direct-gateway.mjs";
const cleanups = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const origin = "https://private.example";
const identity = { "tailscale-user-login": "owner@example.com" };
async function setup() {
  const calls = [];
  const upstream = createServer((req, res) => {
    calls.push(req.headers);
    res.writeHead(200).end("ok");
  });
  upstream.on("upgrade", (req, socket) => {
    calls.push(req.headers);
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.pipe(socket);
    socket.on("error", () => socket.destroy());
    socket.on("end", () => socket.destroy());
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => upstream.close(resolve)));
  const gateway = createDirectGateway({
    origin,
    allowedUser: identity["tailscale-user-login"],
    daemonPort: upstream.address().port,
  });
  const port = await gateway.listen();
  cleanups.push(() => gateway.close());
  return { calls, port, base: `http://127.0.0.1:${port}` };
}
function upgrade(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        ...headers,
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("upgrade", (_res, socket) => {
      socket.once("data", (data) => {
        socket.destroy();
        resolve(data.toString());
      });
      socket.write("roundtrip");
    });
    req.on("error", reject);
    req.end();
  });
}
it("rejects missing/wrong Tailscale identity and foreign browser origins before reaching the daemon", async () => {
  const { base, port, calls } = await setup();
  for (const headers of [
    {},
    { "tailscale-user-login": "stranger@example.com" },
    { ...identity, origin: "https://evil.example" },
    { ...identity, origin: "null" },
  ]) {
    expect((await fetch(`${base}/health`, { headers })).status).toBe(403);
    expect(await upgrade(port, "/ws", headers)).toBe(403);
  }
  expect(calls).toEqual([]);
});
it("only forwards the exact health and socket paths, never credential URLs or control-plane API calls", async () => {
  const { base, port, calls } = await setup();
  for (const path of ["/api/v1/me", "/ws?token=secret", "/other", "/desktop-daemon/ws?x=1"]) {
    expect((await fetch(`${base}${path}`, { headers: identity })).status).toBe(404);
    expect(await upgrade(port, path, identity)).toBe(404);
  }
  expect(calls).toEqual([]);
  expect((await fetch(`${base}/desktop-daemon/health`, { headers: identity })).status).toBe(200);
});
it("adapts approved browser/native sockets and strips cookies, authorization and identity upstream", async () => {
  const { port, calls } = await setup();
  for (const headers of [identity, { ...identity, origin }])
    expect(
      await upgrade(port, "/desktop-daemon/ws", {
        ...headers,
        cookie: "account=secret",
        authorization: "Bearer secret",
      }),
    ).toBe("roundtrip");
  expect(calls).toHaveLength(2);
  for (const headers of calls) {
    expect(headers.origin).toBe("http://localhost:1420");
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["tailscale-user-login"]).toBeUndefined();
  }
});
it("requires an exact safe origin, an allowed identity and a valid loopback destination", () => {
  for (const value of [
    "http://public.example",
    "https://private.example/path",
    "https://user:secret@private.example",
    "https://private.example?token=x",
  ])
    expect(() =>
      createDirectGateway({ origin: value, allowedUser: "owner@example.com", daemonPort: 7420 }),
    ).toThrow();
  expect(() => createDirectGateway({ origin, allowedUser: "", daemonPort: 7420 })).toThrow();
  expect(() =>
    createDirectGateway({ origin, allowedUser: "owner@example.com", daemonPort: 0 }),
  ).toThrow();
});
