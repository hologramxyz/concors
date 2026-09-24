import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { WebSocket, WebSocketServer } from "ws";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemonServer } from "../server.ts";
import { DAEMON_VERSION } from "../version.ts";
import { createTokenVerifier } from "../managed/auth.ts";
import { createLogger } from "../managed/log.ts";
import { createPersistentGateway } from "./gateway.ts";
import { ensureSessionHost } from "./session-host.ts";

vi.mock("./session-host.ts", () => ({
  ensureSessionHost: vi.fn(),
  hostBuild: vi.fn(async () => "test:build"),
}));
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});
const local = { host: "127.0.0.1", port: 0, logLevel: "silent" } as const;
const launch = { executable: "unused", args: [] };

async function fixture(ttl = "15m") {
  const runtime = createDaemonServer(local, { internalToken: "host-secret" });
  const forwarded: { url: string; headers: IncomingHttpHeaders }[] = [];
  runtime.app.addHook("onRequest", async (request) => {
    forwarded.push({ url: request.url, headers: request.headers });
  });
  runtime.app.addHook("onSend", async (_req, reply) => {
    reply.header("x-concors-host", "1");
  });
  runtime.app.post("/echo", async (req) => req.body);
  const stop = vi.fn();
  runtime.app.post("/internal/stop", async () => {
    stop();
    return {};
  });
  const hostUrl = new URL(await runtime.listen());
  cleanups.push(() => runtime.close());
  vi.mocked(ensureSessionHost).mockResolvedValue({
    protocol: 1,
    pid: process.pid,
    port: Number(hostUrl.port),
    token: "host-secret",
  });
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const config = {
    machineId: "machine_1",
    hostname: "m-test.concors.app",
    controlPlaneUrl: "https://api.test",
    agentToken: "agent-secret",
    port: 0,
    tlsDir: "/unused",
  };
  const verifier = createTokenVerifier({
    ...config,
    getKey: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k" }] }),
  });
  const sign = (lifetime: string, subject = "user_1") =>
    new SignJWT({ sub: subject, sid: "session_1", org: "org_1" })
      .setProtectedHeader({ alg: "EdDSA", kid: "k" })
      .setIssuer(config.controlPlaneUrl)
      .setAudience(config.machineId)
      .setIssuedAt()
      .setExpirationTime(lifetime)
      .setJti(crypto.randomUUID())
      .sign(privateKey);
  const token = await sign(ttl);
  const logs: string[] = [];
  const heartbeatFetch = vi.fn<typeof fetch>(async () => new Response("{}"));
  const gateway = createPersistentGateway(local, "unused", launch, {
    config,
    verifier,
    logger: createLogger((line) => logs.push(line)),
    heartbeatFetch,
  });
  const advertised = new URL(await gateway.listen());
  cleanups.push(() => gateway.close());
  const url = `http://127.0.0.1:${advertised.port}`;
  const headers = { host: config.hostname, authorization: `Bearer ${token}` };
  await expect.poll(() => heartbeatFetch.mock.calls.length).toBe(1);
  forwarded.length = 0;
  vi.mocked(ensureSessionHost).mockClear();
  return { gateway, url, headers, token, sign, logs, forwarded, stop, heartbeatFetch };
}

async function refused(
  url: string,
  headers: Record<string, string> = {},
  protocols: string[] = [],
) {
  const ws = new WebSocket(url.replace("http:", "ws:"), protocols, { headers });
  ws.on("error", () => undefined);
  const status = await new Promise<number>((resolve, reject) => {
    ws.once("unexpected-response", (_req, response) => {
      response.resume();
      resolve(response.statusCode!);
      ws.terminate();
    });
    ws.once("open", () => {
      ws.terminate();
      reject(new Error("Unexpected upgrade"));
    });
    ws.once("error", reject);
  });
  return status;
}

it("expires an already authenticated socket and keeps the private host alive", async () => {
  const f = await fixture("3s");
  const ws = new WebSocket(f.url.replace("http:", "ws:") + "/ws", [`concors.bearer.${f.token}`], {
    headers: { host: f.headers.host },
  });
  cleanups.push(async () => {
    ws.terminate();
  });
  await once(ws, "open");
  const closed = once(ws, "close");
  await closed;
  expect(f.stop).not.toHaveBeenCalled();
  expect((await httpFetch(f.url + "/health", { headers: { host: f.headers.host } })).status).toBe(
    200,
  );
  expect(
    await refused(f.url + "/ws", { host: f.headers.host }, [`concors.bearer.${f.token}`]),
  ).toBe(401);
});

async function handshake(f: Awaited<ReturnType<typeof fixture>>) {
  const ws = new WebSocket(f.url.replace("http:", "ws:") + "/ws", [`concors.bearer.${f.token}`], {
    headers: { host: f.headers.host },
  });
  cleanups.push(async () => {
    ws.terminate();
  });
  const messages: { type: string; [key: string]: unknown }[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  await once(ws, "open");
  expect(ws.protocol).toBe(`concors.bearer.${f.token}`);
  ws.send(
    JSON.stringify({
      type: "client.hello",
      protocolVersion: "v1",
      client: { kind: "test", name: "gateway", version: "0.0.0" },
    }),
  );
  await expect.poll(() => messages.some((m) => m.type === "daemon.ready")).toBe(true);
  return { ws, messages };
}

it("advertises in-place renewal and extends a socket for the same device", async () => {
  const f = await fixture("3s");
  const { ws, messages } = await handshake(f);
  expect(messages.find((m) => m.type === "daemon.ready")?.["capabilities"]).toContain(
    "auth-refresh",
  );
  const closed = vi.fn();
  ws.on("close", closed);
  ws.send(JSON.stringify({ type: "auth.refresh", token: await f.sign("15m") }));
  await expect
    .poll(() => messages.find((m) => m.type === "auth.refreshed"))
    .toMatchObject({ ok: true, expiresAt: expect.any(Number) });
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  expect(closed).not.toHaveBeenCalled();
  ws.send(JSON.stringify({ type: "workspace.subscribe" }));
  await expect.poll(() => messages.some((m) => m.type === "workspace.snapshot")).toBe(true);
}, 10_000);

it("refuses to renew with another person's token and expires with 4401", async () => {
  const f = await fixture("3s");
  const { ws, messages } = await handshake(f);
  const closed = once(ws, "close");
  ws.send(JSON.stringify({ type: "auth.refresh", token: await f.sign("15m", "user_2") }));
  await expect
    .poll(() => messages.find((m) => m.type === "auth.refreshed"))
    .toEqual({ type: "auth.refreshed", ok: false });
  const [code] = await closed;
  expect(code).toBe(4401);
  expect(f.stop).not.toHaveBeenCalled();
}, 10_000);

it("lets the desktop client renew access without ever leaving the ready state", async () => {
  const f = await fixture("3s");
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint("wss://m-test.concors.app/ws"),
    client: { kind: "test", name: "gateway", version: "0.0.0" },
    protocols: [`concors.bearer.${f.token}`],
    webSocketFactory: (_url, protocols) =>
      new WebSocket(f.url.replace("http:", "ws:") + "/ws", protocols, {
        headers: { host: f.headers.host },
      }) as never,
  });
  cleanups.push(async () => connection.disconnect());
  const states: string[] = [];
  connection.subscribe((state) => states.push(state.status));
  await connection.connect();
  expect(await connection.refreshAuthorization(await f.sign("15m"))).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  expect(states).toEqual(["connecting", "handshaking", "ready"]);
}, 10_000);

it("keeps health open with version and authenticates all other HTTP requests before routing or host discovery", async () => {
  const f = await fixture();
  for (const path of ["/anything", "/internal/stop", "/ws"]) {
    expect(
      (await httpFetch(f.url + path, { method: "POST", headers: { host: f.headers.host } })).status,
    ).toBe(401);
    expect(
      (await httpFetch(f.url + path, { headers: { ...f.headers, authorization: "Bearer bad" } }))
        .status,
    ).toBe(401);
  }
  expect(ensureSessionHost).not.toHaveBeenCalled();
  expect(f.forwarded).toHaveLength(0);
  const health = await httpFetch(f.url + "/health", { headers: { host: f.headers.host } });
  expect(await health.json()).toEqual({ status: "ok", version: DAEMON_VERSION });
});

it("rejects every unauthenticated upgrade before inspecting its route or Host", async () => {
  const f = await fixture();
  for (const path of ["/ws", "/wrong-path", "/health", "/internal/stop"]) {
    expect(await refused(f.url + path, { host: "wrong.test" })).toBe(401);
    expect(await refused(f.url + path, { ...f.headers, authorization: "Bearer bad" })).toBe(401);
  }
  expect(await refused(f.url + "/ws", { host: f.headers.host }, ["concors.bearer.bad"])).toBe(401);
  expect(ensureSessionHost).not.toHaveBeenCalled();
  expect(f.forwarded).toHaveLength(0);
});

it("requires the exact machine hostname on health, authenticated requests and upgrades", async () => {
  const f = await fixture();
  for (const host of [
    "evil.test",
    "m-test.concors.app.evil.test",
    "m-test.concors.app:1",
    "127.0.0.1",
  ]) {
    expect((await httpFetch(f.url + "/health", { headers: { host } })).status).toBe(403);
    expect((await httpFetch(f.url + "/echo", { headers: { ...f.headers, host } })).status).toBe(
      403,
    );
    expect(await refused(f.url + "/ws", { ...f.headers, host })).toBe(403);
  }
  expect(ensureSessionHost).not.toHaveBeenCalled();
  const host = `${f.headers.host.toUpperCase()}:${new URL(f.url).port}`;
  expect((await httpFetch(f.url + "/health", { headers: { host } })).status).toBe(200);
});

it.each(["protocol", "header", "query"])(
  "proxies authenticated %s sockets to the unchanged host and logs only principal identity",
  async (method) => {
    const f = await fixture();
    const protocol = `concors.bearer.${f.token}`;
    const headers = {
      host: f.headers.host,
      origin: "https://desktop.example.test",
      ...(method === "header" ? { authorization: f.headers.authorization } : {}),
    };
    const url =
      f.url.replace("http:", "ws:") + "/ws" + (method === "query" ? `?token=${f.token}` : "");
    const ws = new WebSocket(url, method === "protocol" ? ["unrelated", protocol] : [], {
      headers,
    });
    cleanups.push(async () => {
      ws.terminate();
    });
    const messages: { type: string }[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await once(ws, "open");
    expect(ws.protocol).toBe(method === "protocol" ? protocol : "");
    ws.send(
      JSON.stringify({
        type: "client.hello",
        protocolVersion: "v1",
        client: { kind: "test", name: "managed", version: "0.0.0" },
      }),
    );
    await expect.poll(() => messages.some((m) => m.type === "daemon.ready")).toBe(true);
    ws.send(JSON.stringify({ type: "workspace.subscribe" }));
    await expect.poll(() => messages.some((m) => m.type === "workspace.snapshot")).toBe(true);
    expect(f.forwarded).toHaveLength(1);
    expect(f.forwarded[0]).toMatchObject({
      url: "/ws",
      headers: { authorization: "Bearer host-secret" },
    });
    expect(f.forwarded[0]!.headers.origin).toBeUndefined();
    expect(JSON.stringify(f.forwarded)).not.toContain(f.token);
    ws.close();
    await once(ws, "close");
    await expect.poll(() => f.logs.length).toBe(2);
    expect(f.logs.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        message: "managed client connected",
        sub: "user_1",
        sid: "session_1",
      }),
      expect.objectContaining({
        message: "managed client disconnected",
        sub: "user_1",
        sid: "session_1",
      }),
    ]);
    expect(f.logs.join()).not.toContain(f.token);
  },
);

it("proxies HTTP bodies, strips query credentials and private response headers, and protects maintenance", async () => {
  const f = await fixture();
  const response = await httpFetch(f.url + `/echo?token=${f.token}&keep=yes`, {
    method: "POST",
    headers: { host: f.headers.host, "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ hello: "world" });
  expect(response.headers.get("x-concors-host")).toBeNull();
  expect(f.forwarded[0]).toMatchObject({
    url: "/echo?keep=yes",
    headers: { authorization: "Bearer host-secret" },
  });
  for (const path of ["/internal/stop", "/%69nternal/stop", "/internal%2fstop"]) {
    expect((await httpFetch(f.url + path, { method: "POST", headers: f.headers })).status).toBe(
      404,
    );
  }
  expect(f.stop).not.toHaveBeenCalled();
});

it("authenticates detected preview hosts once, proxies browser traffic and supports HMR sockets", async () => {
  const f = await fixture();
  const seen: IncomingHttpHeaders[] = [];
  const previewServer = createServer((request, response) => {
    seen.push(request.headers);
    response.writeHead(200, { "content-type": "text/html" }).end("<h1>Preview app</h1>");
  });
  const previewSockets = new WebSocketServer({ server: previewServer });
  previewSockets.on("connection", (socket) =>
    socket.on("message", (message) => socket.send(message)),
  );
  await new Promise<void>((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        previewServer.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = previewServer.address();
  if (!address || typeof address === "string") throw new Error("Preview fixture did not listen");
  const host = `${address.port}.${f.headers.host}`;
  const login = await httpFetch(f.url + "/", { headers: { host } });
  expect(login.status).toBe(401);
  expect(await login.text()).toContain("Opening preview");
  const authorized = await httpFetch(f.url + "/__concors/preview-auth", {
    method: "POST",
    headers: { host, "content-type": "text/plain" },
    body: f.token,
  });
  expect(authorized.status).toBe(204);
  const cookie = authorized.headers.get("set-cookie")!.split(";", 1)[0]!;
  const page = await httpFetch(f.url + "/feature?ready=yes", { headers: { host, cookie } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Preview app");
  expect(seen[0]).toMatchObject({
    host: `localhost:${address.port}`,
    "x-forwarded-host": host,
    "x-forwarded-proto": "https",
  });
  expect(seen[0]?.cookie).toBeUndefined();

  const socket = new WebSocket(f.url.replace("http:", "ws:") + "/hmr", [], {
    headers: { host, cookie },
  });
  cleanups.push(async () => socket.terminate());
  await once(socket, "open");
  socket.send("ready");
  const [message] = await once(socket, "message");
  expect(message.toString()).toBe("ready");
});

it("starts a heartbeat after listen using the private host's session snapshot", async () => {
  const f = await fixture();
  const [url, request] = f.heartbeatFetch.mock.calls[0]!;
  expect(url).toBe("https://api.test/api/v1/agent/heartbeat");
  expect(request?.headers).toMatchObject({ authorization: "Bearer machine_1.agent-secret" });
  expect(JSON.parse(request!.body as string)).toMatchObject({
    version: DAEMON_VERSION,
    sessions: 0,
  });
});

it("retains the local loopback guard", () => {
  expect(() => createPersistentGateway({ ...local, host: "0.0.0.0" }, "unused", launch)).toThrow(
    /loopback/,
  );
});

// Node fetch owns Host; use the HTTP client to exercise the gateway's hostname allowlist.
function httpFetch(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, init, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () =>
        resolve(
          new Response(
            [204, 205, 304].includes(response.statusCode!) ? null : Buffer.concat(chunks),
            {
              status: response.statusCode!,
              headers: response.headers as Record<string, string>,
            },
          ),
        ),
      );
    });
    request.on("error", reject);
    request.end(init.body);
  });
}

it("rejects unauthenticated Expect requests before inviting a body", async () => {
  const f = await fixture();
  const continued = vi.fn();
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      f.url + "/echo",
      {
        method: "POST",
        headers: { host: f.headers.host, expect: "100-continue", "content-length": "1000000" },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    req.on("continue", continued);
    req.on("error", reject);
    req.flushHeaders();
  });
  expect(status).toBe(401);
  expect(continued).not.toHaveBeenCalled();
  expect(ensureSessionHost).not.toHaveBeenCalled();
});
