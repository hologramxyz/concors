import { parseClientMessage, type ClientInfo, type DaemonMessage } from "@concors/protocol";
import { describe, expect, it, vi } from "vitest";

import { DaemonConnection, DaemonConnectionError, type WebSocketLike } from "./connection.ts";
import { describeDaemonEndpoint } from "./endpoint.ts";

/** In-memory WebSocket double that lets a test play the daemon's side of the conversation. */
class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly closed: { code: number | undefined; reason: string | undefined }[] = [];
  readonly #listeners = new Map<string, ((event: never) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closed.push({ code, reason });
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const existing = this.#listeners.get(type) ?? [];
    existing.push(listener);
    this.#listeners.set(type, existing);
  }

  // ── test-side controls (the "daemon") ──
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit("open", undefined);
  }
  serverSend(message: DaemonMessage | string): void {
    this.#emit("message", {
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }
  serverClose(code = 1000, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close", { code, reason });
  }
  serverError(): void {
    this.#emit("error", undefined);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}

const client: ClientInfo = { kind: "test", name: "vitest", version: "0.0.0" };

const READY: DaemonMessage = {
  type: "daemon.ready",
  protocolVersion: "v1",
  daemonVersion: "0.1.0",
  status: "ready",
};

/** Creates a connection wired to FakeWebSocket and starts `connect()`. */
function startConnection() {
  const sockets: FakeWebSocket[] = [];
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint("wss://daemon.example/ws"),
    client,
    handshakeTimeoutMs: 50,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  const states: string[] = [];
  connection.subscribe((state) => states.push(state.status));

  const ready = connection.connect();
  const socket = sockets[0]!;
  return { connection, states, ready, socket, sockets };
}

describe("DaemonConnection", () => {
  it("resubscribes after reconnect without accepting the old socket's readings", async () => {
    const { connection, socket, ready, sockets } = startConnection();
    const listener = vi.fn();
    connection.subscribeHostUsage(listener);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["host-usage"] });
    await ready;
    socket.serverClose();
    const reconnected = connection.connect();
    const next = sockets[1]!;
    next.serverOpen();
    next.serverSend({ ...READY, capabilities: ["host-usage"] });
    await reconnected;
    expect(next.sent.map((raw) => JSON.parse(raw))).toContainEqual({
      type: "host.subscribe",
      enabled: true,
    });
    const count = listener.mock.calls.length;
    socket.serverSend({ type: "host.usage", usage: null });
    expect(listener).toHaveBeenCalledTimes(count);
    connection.disconnect();
  });
  it("opts into host usage once, clears disconnected readings, and stops after the last observer", async () => {
    const { connection, socket, ready } = startConnection();
    const first = vi.fn(),
      second = vi.fn();
    const offFirst = connection.subscribeHostUsage(first);
    expect(socket.sent).toEqual([]);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["host-usage"] });
    await ready;
    const usage = {
      sampledAt: 1,
      cpuPercent: 80,
      cpuCount: 2,
      memory: { usedBytes: 6, totalBytes: 8 },
    };
    socket.serverSend({ type: "host.usage", usage });
    expect(first).toHaveBeenLastCalledWith(usage);
    const offSecond = connection.subscribeHostUsage(second);
    expect(second).toHaveBeenLastCalledWith(usage);
    expect(
      socket.sent
        .map((raw) => JSON.parse(raw))
        .filter((message) => message.type === "host.subscribe"),
    ).toEqual([{ type: "host.subscribe", enabled: true }]);
    offFirst();
    offSecond();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "host.subscribe", enabled: false });
    connection.subscribeHostUsage(second);
    expect(second).toHaveBeenLastCalledWith(null);
    socket.serverSend({ type: "host.usage", usage });
    socket.serverClose();
    expect(second).toHaveBeenLastCalledWith(null);
  });

  it("does not request metrics from older daemons or without subscribers", async () => {
    const { connection, socket, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    const off = connection.subscribeHostUsage(vi.fn());
    off();
    expect(socket.sent).toHaveLength(1);
    connection.disconnect();
  });

  it("ignores malformed usage and replaces failed readings with unavailable", async () => {
    const { connection, socket, ready } = startConnection();
    const listener = vi.fn();
    connection.subscribeHostUsage(listener);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["host-usage"] });
    await ready;
    socket.serverSend(JSON.stringify({ type: "host.usage", usage: { cpuPercent: 500 } }));
    expect(connection.state.status).toBe("ready");
    expect(listener).toHaveBeenCalledTimes(2);
    socket.serverSend({ type: "host.usage", usage: null });
    expect(listener).toHaveBeenLastCalledWith(null);
    connection.disconnect();
  });

  it.each([
    { protocols: "concors.bearer.test-token" },
    { protocols: ["concors.bearer.test-token"] as const },
    { protocols: undefined },
  ])("preserves subprotocol values for custom transports: %j", async ({ protocols }) => {
    const socket = new FakeWebSocket("wss://daemon.example/ws");
    const factory = vi.fn(() => socket);
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint(socket.url),
      client,
      ...(protocols === undefined ? {} : { protocols }),
      webSocketFactory: factory,
    });
    const ready = connection.connect();
    expect(factory).toHaveBeenCalledWith(socket.url, protocols);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    connection.disconnect();
  });

  it("copies subprotocol arrays before the caller can mutate them", async () => {
    const socket = new FakeWebSocket("wss://daemon.example/ws");
    const factory = vi.fn(() => socket);
    const protocols = ["concors.bearer.test-token"];
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint(socket.url),
      client,
      protocols,
      webSocketFactory: factory,
    });
    protocols.push("unexpected-protocol");
    const ready = connection.connect();
    expect(factory).toHaveBeenCalledWith(socket.url, ["concors.bearer.test-token"]);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    connection.disconnect();
  });

  it.each([
    { protocols: "concors.bearer.test-token" },
    { protocols: ["concors.bearer.test-token"] as const },
  ])(
    "passes bearer protocols %j to the native WebSocket constructor without changing the URL",
    async ({ protocols }) => {
      const socket = new FakeWebSocket("wss://daemon.example/ws");
      const constructor = vi.fn(function () {
        return socket;
      });
      vi.stubGlobal("WebSocket", constructor);
      try {
        const connection = new DaemonConnection({
          endpoint: describeDaemonEndpoint(socket.url),
          client,
          protocols,
        });
        const ready = connection.connect();
        expect(constructor).toHaveBeenCalledWith(socket.url, protocols);
        socket.serverOpen();
        socket.serverSend(READY);
        await ready;
        connection.disconnect();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("sends client.hello on open and becomes ready on daemon.ready", async () => {
    const { connection, socket, states, ready } = startConnection();

    socket.serverOpen();
    const hello = parseClientMessage(socket.sent[0]);
    expect(hello.success).toBe(true);
    if (hello.success) {
      expect(hello.data).toMatchObject({ type: "client.hello", protocolVersion: "v1", client });
    }

    socket.serverSend(READY);

    await expect(ready).resolves.toEqual({
      protocolVersion: "v1",
      daemonVersion: "0.1.0",
      status: "ready",
    });
    expect(connection.state.status).toBe("ready");
    expect(states).toEqual(["connecting", "handshaking", "ready"]);
  });

  it("surfaces a protocol error from the daemon and closes the socket", async () => {
    const { connection, socket, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend({
      type: "error",
      error: { code: "PROTOCOL_VERSION_UNSUPPORTED", message: "nope" },
    });

    await expect(ready).rejects.toBeInstanceOf(DaemonConnectionError);
    expect(connection.state).toEqual({
      status: "error",
      error: { code: "PROTOCOL_VERSION_UNSUPPORTED", message: "nope" },
    });
    expect(socket.closed).toHaveLength(1);
  });

  it("fails with INVALID_MESSAGE when the daemon sends garbage during the handshake", async () => {
    const { socket, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend("{ definitely not json");

    await expect(ready).rejects.toMatchObject({ error: { code: "INVALID_MESSAGE" } });
  });

  it("times out if daemon.ready never arrives", async () => {
    vi.useFakeTimers();
    try {
      const { socket, ready } = startConnection();
      socket.serverOpen();
      const assertion = expect(ready).rejects.toMatchObject({
        error: { code: "HANDSHAKE_TIMEOUT" },
      });
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a clean disconnect after being ready", async () => {
    const { connection, socket, states, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;

    socket.serverClose(1001, "daemon going away");
    expect(connection.state).toEqual({
      status: "disconnected",
      reason: "daemon going away",
      closeCode: 1001,
    });
    expect(states.at(-1)).toBe("disconnected");
  });

  it("rejects when the socket errors before opening", async () => {
    const { socket, ready } = startConnection();
    socket.serverError();
    await expect(ready).rejects.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("disconnect() is idempotent and rejects a pending connect()", async () => {
    const { connection, socket, ready } = startConnection();
    socket.serverOpen();
    connection.disconnect();
    connection.disconnect();
    expect(socket.closed).toHaveLength(1);
    expect(connection.state.status).toBe("disconnected");
    await expect(ready).rejects.toBeInstanceOf(DaemonConnectionError);
    // A late close event from the torn-down socket must not disturb the state.
    socket.serverClose(1000, "client disconnect");
    expect(connection.state.status).toBe("disconnected");
  });

  it("can connect again after disconnecting", async () => {
    const { connection, socket, sockets, states, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    connection.disconnect();

    const second = connection.connect();
    const socket2 = sockets[1]!;
    socket2.serverOpen();
    socket2.serverSend(READY);
    await expect(second).resolves.toMatchObject({ daemonVersion: "0.1.0" });
    expect(states.filter((s) => s === "ready")).toHaveLength(2);
  });
});

describe("workspace replica lifecycle", () => {
  const snapshot = {
    schemaVersion: 1 as const,
    machineId: "00000000-0000-4000-8000-000000000001",
    epoch: "00000000-0000-4000-8000-000000000002",
    revision: 2,
    projects: [],
    selection: null,
  };

  it("ignores stale snapshots and rejects pending commands on disconnect", async () => {
    const { connection, socket, ready } = startConnection();
    const listener = vi.fn();
    connection.subscribeWorkspace(listener);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    expect(JSON.parse(socket.sent[1]!)).toEqual({ type: "workspace.subscribe" });
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    socket.serverSend({ type: "workspace.snapshot", snapshot: { ...snapshot, revision: 1 } });
    expect(connection.workspace?.revision).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    const pending = connection.executeWorkspace({
      type: "workspace.command",
      commandId: "00000000-0000-4000-8000-000000000003",
      epoch: snapshot.epoch,
      operation: {
        kind: "project.add",
        projectId: "00000000-0000-4000-8000-000000000004",
        name: "Test",
        directory: "/test",
      },
    });
    const rejection = expect(pending).rejects.toThrow("outcome may be unknown");
    socket.serverClose();
    await rejection;
    expect(connection.workspace).toBeNull();
    connection.disconnect();
  });
});
