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
async function setup(profileOptions = {}) {
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
    ...profileOptions,
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
    expect((await fetch(`${base}/profile-api/api/v1/me`, { headers })).status).toBe(403);
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

it("proxies only profile authentication to the configured API after private authentication", async () => {
  const requests = [];
  const { base, calls } = await setup({
    profileApiUrl: "https://accounts.example",
    profileFetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ user: { name: "Test User" }, token: "test-token" }), {
        headers: { "set-cookie": "secret=not-for-preview", "set-auth-token": "test-token" },
      });
    },
  });
  const response = await fetch(`${base}/desktop-daemon/profile-api/api/auth/sign-in/email`, {
    method: "POST",
    headers: { ...identity, origin, "content-type": "application/json", cookie: "private=secret" },
    body: JSON.stringify({ email: "owner@example.com", password: "fixture-only" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("set-auth-token")).toBe("test-token");
  await fetch(`${base}/profile-api/api/v1/me`, {
    headers: { ...identity, authorization: "Bearer fixture" },
  });
  expect(requests.map(({ url }) => url)).toEqual([
    "https://accounts.example/api/auth/sign-in/email",
    "https://accounts.example/api/v1/me",
  ]);
  expect(requests[0].init.headers).toEqual({
    "content-type": "application/json",
    origin: "https://accounts.example",
  });
  expect(requests[0].init.redirect).toBe("error");
  expect(requests[1].init.headers.authorization).toBe("Bearer fixture");
  expect(
    (
      await fetch(`${base}/profile-api/api/v1/github/`, {
        headers: { ...identity, authorization: "Bearer fixture" },
      })
    ).status,
  ).toBe(200);
  expect(requests[2].url).toBe("https://accounts.example/api/v1/github/");
  expect(requests[2].init.headers.authorization).toBe("Bearer fixture");
  expect(
    (
      await fetch(`${base}/profile-api/api/v1/github/`, {
        method: "DELETE",
        headers: identity,
      })
    ).status,
  ).toBe(404);
  expect(calls).toEqual([]);
  for (const path of [
    "/api/v1/machines",
    "/api/v1/github/accounts",
    "/api/v1/github/connect",
    "/api/v1/github/?page=1",
    "/api/auth/sign-up/email",
    "/api/v1/me?token=x",
    "/api/v1/me/",
    "//other.example/api/v1/me",
  ])
    expect((await fetch(`${base}/profile-api${path}`, { headers: identity })).status).toBe(404);
  expect(
    (await fetch(`${base}/profile-api/api/auth/sign-in/email`, { headers: identity })).status,
  ).toBe(404);
  expect(requests).toHaveLength(3);
});

it("profile proxy stays disabled by default and rejects unsafe origins and oversized credentials", async () => {
  const { base } = await setup();
  expect((await fetch(`${base}/profile-api/api/v1/me`, { headers: identity })).status).toBe(404);
  for (const profileApiUrl of [
    "http://accounts.example",
    "https://user:secret@accounts.example",
    "https://accounts.example/path",
  ])
    expect(() =>
      createDirectGateway({
        origin,
        allowedUser: "owner@example.com",
        daemonPort: 7420,
        profileApiUrl,
      }),
    ).toThrow();
  let forwarded = false;
  const enabled = await setup({
    profileApiUrl: "https://accounts.example",
    profileFetch: async () => {
      forwarded = true;
      return new Response("{}");
    },
  });
  expect(
    (
      await fetch(`${enabled.base}/profile-api/api/auth/sign-in/email`, {
        method: "POST",
        headers: { ...identity, "content-type": "application/json" },
        body: "x".repeat(16_385),
      })
    ).status,
  ).toBe(413);
  expect(forwarded).toBe(false);
});
