import { createApiClient, memoryTokenStore } from "@concors/api-client";
import { describeDaemonEndpoint, type WebSocketLike } from "@concors/daemon-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectHost } from "./connect-host";

class Socket implements WebSocketLike {
  readyState = 0;
  send = vi.fn();
  close = vi.fn();
  listeners = new Map<string, ((event: never) => void)[]>();
  addEventListener(type: string, listener: (event: never) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
  ready(capabilities?: string[]) {
    this.emit("open");
    this.emit("message", {
      data: JSON.stringify({
        type: "daemon.ready",
        protocolVersion: "v1",
        daemonVersion: "0.2.0",
        status: "ready",
        ...(capabilities ? { capabilities } : {}),
      }),
    });
  }
  sent() {
    return this.send.mock.calls.map(
      ([data]) => JSON.parse(String(data)) as Record<string, unknown>,
    );
  }
}
const snapshot = {
  schemaVersion: 1,
  machineId: "00000000-0000-4000-8000-000000000001",
  epoch: "00000000-0000-4000-8000-000000000002",
  revision: 0,
  projects: [],
  selection: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

function setup({
  status = 201,
  machineId = "machine/1",
  socketStatus,
  online = true,
  token = (count: number) => `token-${count}`,
}: {
  status?: number;
  machineId?: string;
  socketStatus?: number;
  online?: boolean;
  token?: (count: number) => string;
} = {}) {
  vi.useFakeTimers();
  const fetch = vi.fn(async () =>
    json(
      status === 201 ? { token: token(fetch.mock.calls.length) } : { message: "Unauthorized" },
      status,
    ),
  );
  const sockets: Socket[] = [];
  const webSocketFactory = vi.fn(() => {
    if (socketStatus) throw { status: socketStatus };
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  const onState = vi.fn(),
    onTransport = vi.fn(),
    onWorkspace = vi.fn();
  const session = connectHost({
    machineId,
    endpoint: describeDaemonEndpoint("wss://machine.example/ws"),
    api: createApiClient({
      baseUrl: "https://api.example",
      tokenStore: memoryTokenStore("session"),
      fetch,
    }),
    client: { kind: "test", name: "test", version: "0.0.0" },
    webSocketFactory,
    isOnline: () => online,
    onState,
    onTransport,
    onWorkspace,
  });
  disposers.push(session.dispose);
  return { session, fetch, sockets, webSocketFactory, onState, onTransport, onWorkspace };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
/** A 15-minute machine token as minted now; only its `exp` matters to the client. */
const jwt = (count: number) =>
  [
    btoa(JSON.stringify({ alg: "EdDSA" })),
    btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 15 * 60, n: count })).replace(
      /=+$/,
      "",
    ),
    "signature",
  ].join(".");

describe("managed host connection", () => {
  it("mints immediately before connecting, uses a bearer subprotocol, and subscribes to the workspace", async () => {
    const t = setup();
    expect(t.webSocketFactory).not.toHaveBeenCalled();
    await flush();
    expect(t.fetch).toHaveBeenCalledWith(
      "https://api.example/api/v1/machines/machine%2F1/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(t.webSocketFactory).toHaveBeenCalledWith("wss://machine.example/ws", [
      "concors.bearer.token-1",
    ]);
    t.sockets[0]!.ready();
    expect(t.sockets[0]!.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "workspace.subscribe" }),
    );
    t.sockets[0]!.emit("message", {
      data: JSON.stringify({ type: "workspace.snapshot", snapshot }),
    });
    expect(t.onWorkspace).toHaveBeenCalledWith(snapshot);
  });
  it.each([false, true])(
    "refreshes once on 4401 (already ready: %s), then stops with access revoked",
    async (ready) => {
      const t = setup();
      await flush();
      if (ready) t.sockets[0]!.ready();
      t.sockets[0]!.emit("close", { code: 4401, reason: "expired" });
      await flush();
      expect(t.webSocketFactory).toHaveBeenLastCalledWith("wss://machine.example/ws", [
        "concors.bearer.token-2",
      ]);
      t.sockets[1]!.emit("close", { code: 4401, reason: "revoked" });
      expect(t.onState).toHaveBeenLastCalledWith(
        { status: "error", error: { code: "INTERNAL_ERROR", message: "Access revoked" } },
        false,
      );
      t.session.resume();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(t.fetch).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["api", "socket"])("mints only twice on %s HTTP 401", async (source) => {
    const t = setup(source === "api" ? { status: 401 } : { socketStatus: 401 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: "Access revoked" }) }),
      false,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });
  it("refreshes again for later token expiry after a successful authenticated reconnection", async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.ready();
    t.sockets[0]!.emit("close", { code: 4401, reason: "expired" });
    await flush();
    t.sockets[1]!.ready();
    t.sockets[1]!.emit("close", { code: 4401, reason: "expired later" });
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(3);
    t.sockets[2]!.ready();
    expect(t.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" }), false);
  });
  it("allows an explicit user retry after access was revoked", async () => {
    const t = setup({ status: 401 });
    await vi.advanceTimersByTimeAsync(10);
    t.fetch.mockResolvedValueOnce(json({ token: "restored-token" }, 201));
    t.session.reconnect();
    await flush();
    expect(t.webSocketFactory).toHaveBeenCalledWith("wss://machine.example/ws", [
      "concors.bearer.restored-token",
    ]);
  });
  it("retries an opaque browser upgrade failure only once", async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.emit("error");
    await flush();
    t.sockets[1]!.emit("error");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.onState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining("access revoked") }),
      }),
      false,
    );
  });
  it("reconnects normal drops with a fresh token and backoff", async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.ready();
    t.sockets[0]!.emit("close", { code: 1006, reason: "network" });
    await vi.advanceTimersByTimeAsync(999);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });
  it("restores a long-lived connection at once on the same transport, flagged as reconnecting", async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.ready();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    t.sockets[0]!.emit("close", { code: 1006, reason: "" });
    expect(t.onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "disconnected" }),
      true,
    );
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(2);
    t.sockets[1]!.ready();
    expect(t.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" }), false);
    expect(t.onTransport).toHaveBeenCalledTimes(1);
  });
  it("does not report a first connection that has never been ready as reconnecting", async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.emit("close", { code: 1006, reason: "" });
    expect(t.onState.mock.calls.every(([, reconnecting]) => reconnecting === false)).toBe(true);
  });
  it("keeps a live socket through OS network events", async () => {
    const t = setup({ online: false });
    await flush();
    t.sockets[0]!.ready();
    t.session.offline();
    t.session.resume();
    t.session.offline();
    await vi.advanceTimersByTimeAsync(5_000);
    t.sockets[0]!.emit("message", {
      data: JSON.stringify({ type: "workspace.snapshot", snapshot }),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.webSocketFactory).toHaveBeenCalledTimes(1);
    expect(t.sockets[0]!.close).not.toHaveBeenCalled();
  });
  it("replaces a socket that goes silent while the device stays offline", async () => {
    const t = setup({ online: false });
    await flush();
    t.sockets[0]!.ready();
    await vi.advanceTimersByTimeAsync(60_000);
    t.session.offline();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(t.sockets[0]!.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sockets[0]!.close).toHaveBeenCalled();
    expect(t.onState).toHaveBeenCalledWith(
      { status: "disconnected", reason: "Device is offline" },
      true,
    );
    await vi.advanceTimersByTimeAsync(1); // A 0ms timer set during a fake tick runs after 1ms.
    expect(t.webSocketFactory).toHaveBeenCalledTimes(2);
  });
  it("renews access on the live socket before each token expires", async () => {
    const t = setup({ token: jwt });
    await flush();
    t.sockets[0]!.ready(["auth-refresh"]);
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(2);
    const renewal = t.sockets[0]!.sent().at(-1);
    expect(renewal).toMatchObject({ type: "auth.refresh" });
    t.sockets[0]!.emit("message", {
      data: JSON.stringify({ type: "auth.refreshed", ok: true, expiresAt: Date.now() + 900_000 }),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(13 * 60_000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(3);
    expect(t.webSocketFactory).toHaveBeenCalledTimes(1);
    expect(t.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" }), false);
  });
  it("retries a refused renewal and never renews through a gateway without support", async () => {
    const t = setup({ token: jwt });
    await flush();
    t.sockets[0]!.ready(["auth-refresh"]);
    await vi.advanceTimersByTimeAsync(13 * 60_000);
    await flush();
    t.sockets[0]!.emit("message", {
      data: JSON.stringify({ type: "auth.refreshed", ok: false }),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(3);

    const legacy = setup({ token: jwt });
    await flush();
    legacy.sockets[0]!.ready();
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(legacy.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not open a socket after selection changes while a token is pending", async () => {
    const t = setup();
    t.session.dispose();
    await flush();
    expect(t.webSocketFactory).not.toHaveBeenCalled();
  });
  it("connects locally without a token or subprotocol", async () => {
    const t = setup({ machineId: "local" });
    await flush();
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.webSocketFactory).toHaveBeenCalledWith("wss://machine.example/ws", undefined);
  });
  it("backs off API outages without opening an unauthenticated socket", async () => {
    const t = setup({ status: 503 });
    await flush();
    expect(t.webSocketFactory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.webSocketFactory).not.toHaveBeenCalled();
  });
});
