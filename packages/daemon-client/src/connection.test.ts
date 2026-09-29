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
  it("keeps remote preview credentials in URL fragments and opens local previews directly", () => {
    const remote = new DaemonConnection({
      endpoint: describeDaemonEndpoint("wss://m-example.dev.concors.app/ws"),
      client,
      protocols: ["concors.bearer.preview-token"],
    });
    const remoteUrl = new URL(remote.previewUrl({ port: 5173, protocol: "http" })!);
    expect(remoteUrl.origin).toBe("https://5173.m-example.dev.concors.app");
    expect(remoteUrl.search).toBe("");
    expect(new URLSearchParams(remoteUrl.hash.slice(1)).get("access_token")).toBe("preview-token");
    expect(
      new DaemonConnection({
        endpoint: describeDaemonEndpoint("ws://127.0.0.1:7420/ws"),
        client,
      }).previewUrl({ port: 5173, protocol: "http" }),
    ).toBe("http://127.0.0.1:5173/");
    expect(
      new DaemonConnection({
        endpoint: describeDaemonEndpoint("wss://preview.example/path/ws"),
        client,
        protocols: ["concors.bearer.preview-token"],
      }).previewUrl({ port: 5173, protocol: "http" }),
    ).toBeNull();
  });

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

  it("reconnects the same instance with a fresh token after the socket drops", async () => {
    const sockets: FakeWebSocket[] = [];
    const factory = vi.fn((url: string) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    });
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint("wss://daemon.example/ws"),
      client,
      protocols: ["concors.bearer.first"],
      webSocketFactory: factory,
    });
    const first = connection.connect();
    sockets[0]!.serverOpen();
    sockets[0]!.serverSend(READY);
    await first;
    expect(connection.lastMessageAt).toBeGreaterThan(0);
    sockets[0]!.serverClose(1006);

    const second = connection.connect(["concors.bearer.second"]);
    expect(factory).toHaveBeenLastCalledWith("wss://daemon.example/ws", ["concors.bearer.second"]);
    sockets[1]!.serverOpen();
    sockets[1]!.serverSend(READY);
    await second;
    expect(connection.previewUrl({ protocol: "http", port: 3000 })).toContain(
      "access_token=second",
    );
  });
});

describe("in-place access renewal", () => {
  it("renews only through a gateway that offers it and uses the new token for previews", async () => {
    const { connection, socket, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["auth-refresh"] });
    await ready;
    const renewed = connection.refreshAuthorization("fresh");
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "auth.refresh", token: "fresh" });
    socket.serverSend({ type: "auth.refreshed", ok: true, expiresAt: Date.now() + 900_000 });
    await expect(renewed).resolves.toBe(true);
    expect(connection.previewUrl({ protocol: "http", port: 3000 })).toContain("access_token=fresh");
    const refused = connection.refreshAuthorization("other");
    socket.serverSend({ type: "auth.refreshed", ok: false });
    await expect(refused).resolves.toBe(false);
    const cut = connection.refreshAuthorization("late");
    socket.serverClose(1006);
    await expect(cut).resolves.toBe(false);
  });

  it("never sends a renewal to a daemon that does not advertise it", async () => {
    const { connection, socket, ready } = startConnection();
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    await expect(connection.refreshAuthorization("fresh")).resolves.toBe(false);
    expect(socket.sent.some((raw) => raw.includes("auth.refresh"))).toBe(false);
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

  it("keeps agents and terminals listed through a reconnect until the daemon resyncs", async () => {
    const { connection, socket, sockets, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    const lists: number[] = [];
    connection.onAgent((event) => {
      if (event.type === "agent.list") lists.push(event.agents.length);
    });
    const at = "2026-09-23T00:00:00.000Z";
    const agent = (id: string, revision: number) =>
      ({
        type: "agent.state",
        agent: {
          id,
          projectId: "00000000-0000-4000-8000-000000000010",
          provider: "codex",
          name: "Agent",
          directory: "/project",
          model: null,
          threadId: null,
          turnId: null,
          status: "idle",
          error: null,
          startedAt: at,
          turnStartedAt: null,
          updatedAt: at,
          revision,
          pending: [],
          attention: null,
        },
      }) as DaemonMessage;
    const terminal = (id: string) =>
      ({
        type: "terminal.state",
        session: {
          id,
          projectId: "00000000-0000-4000-8000-000000000010",
          profile: "shell",
          directory: "/project",
          status: "running",
          exitCode: null,
          error: null,
          startedAt: at,
          cols: 80,
          rows: 24,
        },
      }) as DaemonMessage;
    const kept = "00000000-0000-4000-8000-000000000011";
    const gone = "00000000-0000-4000-8000-000000000012";
    const sync = (target: FakeWebSocket, revision: number, ids: string[]) => {
      target.serverSend({ type: "agent.list", agents: [] });
      for (const id of ids) target.serverSend(terminal(id));
      for (const id of ids) target.serverSend(agent(id, revision));
    };
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    sync(socket, 9, [kept, gone]);
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    expect(connection.agents.map((a) => a.id)).toEqual([kept, gone]);
    socket.serverClose(1006);

    const again = connection.connect();
    sockets[1]!.serverOpen();
    sockets[1]!.serverSend(READY);
    await again;
    lists.length = 0;
    sync(sockets[1]!, 1, [kept]);
    // Mid-resync: nothing has been emptied, and a restarted daemon's lower revision still applies.
    expect(lists).toEqual([]);
    expect(connection.terminals).toHaveLength(2);
    expect(connection.agents.find((a) => a.id === kept)?.revision).toBe(1);
    sockets[1]!.serverSend({ type: "workspace.snapshot", snapshot });
    expect(lists).toEqual([1]);
    expect(connection.agents.map((a) => a.id)).toEqual([kept]);
    expect(connection.terminals.map((t) => t.id)).toEqual([kept]);
  });

  it("gates resource requests and rejects uncertain mutations on disconnect", async () => {
    const { connection, socket, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["machine-resources"] });
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    const id = "00000000-0000-4000-8000-000000000003";
    const pending = connection.requestResource({ kind: "processes" }, id);
    await expect(connection.requestResource({ kind: "processes" }, id)).rejects.toThrow(
      "already pending",
    );
    socket.serverSend({
      type: "resource.result",
      requestId: id,
      outcome: { status: "processes", snapshot: { sampledAt: 1, processes: [], warnings: [] } },
    });
    await expect(pending).resolves.toMatchObject({ outcome: { status: "processes" } });
    const stop = connection.requestResource({ kind: "stop", id: "42:100" }, id);
    const rejected = expect(stop).rejects.toThrow("may have completed");
    socket.serverClose();
    await rejected;
  });
  it("never sends resource requests to an older daemon", async () => {
    const { connection, socket, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    await expect(
      connection.requestResource({ kind: "processes" }, "00000000-0000-4000-8000-000000000003"),
    ).rejects.toThrow("Update");
    expect(socket.sent.some((raw) => JSON.parse(raw).type === "resource.request")).toBe(false);
    connection.disconnect();
  });

  it("gates pull request listings on the daemon capability and settles them on disconnect", async () => {
    const operation = { kind: "list" as const, epoch: snapshot.epoch, projects: [] };
    const id = "00000000-0000-4000-8000-000000000003";
    const older = startConnection();
    older.connection.subscribeWorkspace(() => undefined);
    older.socket.serverOpen();
    older.socket.serverSend(READY);
    await older.ready;
    older.socket.serverSend({ type: "workspace.snapshot", snapshot });
    await expect(older.connection.requestPullRequests(operation, id)).rejects.toThrow("Update");
    expect(older.socket.sent.some((raw) => JSON.parse(raw).type === "pull-request.request")).toBe(
      false,
    );
    older.connection.disconnect();

    const { connection, socket, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["workspace-pull-requests"] });
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    const pending = connection.requestPullRequests(operation, id);
    socket.serverSend({
      type: "pull-request.result",
      requestId: id,
      outcome: { status: "listed", viewer: "octocat", fetchedAt: 1, workspaces: [] },
    });
    await expect(pending).resolves.toMatchObject({ outcome: { status: "listed" } });
    const merge = {
      kind: "merge" as const,
      epoch: snapshot.epoch,
      projectId: snapshot.epoch,
      repository: "hologramxyz/concors",
      number: 7,
      method: "squash" as const,
      expectedHeadSha: "a".repeat(40),
    };
    // Nor that it can list merged or closed pull requests.
    await expect(
      connection.requestPullRequests({ ...operation, state: "merged" }, id),
    ).rejects.toThrow("merged and closed");
    // Listing alone does not imply the daemon can act on pull requests.
    await expect(connection.requestPullRequests(merge, id)).rejects.toThrow("manage pull requests");
    const lost = expect(connection.requestPullRequests(operation, id)).rejects.toThrow(
      "may have completed",
    );
    socket.serverClose();
    await lost;
  });

  it("never asks an older daemon for plan usage", async () => {
    const { connection, socket, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    await expect(
      connection.requestAgent(
        { kind: "usage", sessionId: "00000000-0000-4000-8000-000000000004" },
        "00000000-0000-4000-8000-000000000003",
      ),
    ).rejects.toThrow("plan usage");
    expect(socket.sent.some((raw) => JSON.parse(raw).type === "agent.request")).toBe(false);
    connection.disconnect();
  });

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

describe("schedule replica lifecycle", () => {
  const snapshot = {
    schemaVersion: 1 as const,
    machineId: "00000000-0000-4000-8000-000000000001",
    epoch: "00000000-0000-4000-8000-000000000002",
    revision: 0,
    projects: [],
    selection: null,
  };
  it("settles actions and clears the machine's schedule replica on disconnect", async () => {
    const { connection, socket, ready } = startConnection(),
      listener = vi.fn();
    connection.subscribeWorkspace(() => undefined);
    connection.onSchedules(listener);
    socket.serverOpen();
    socket.serverSend({ ...READY, capabilities: ["agent-schedules-v1"] });
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    socket.serverSend({ type: "schedule.list", schedules: [] });
    expect(listener).toHaveBeenLastCalledWith([]);
    const id = "00000000-0000-4000-8000-000000000003";
    const pending = connection.requestSchedule({ kind: "list" }, id);
    socket.serverSend({
      type: "schedule.result",
      requestId: id,
      outcome: { status: "ok", schedules: [] },
    });
    await expect(pending).resolves.toMatchObject({ outcome: { status: "ok" } });
    const interrupted = connection.requestSchedule({ kind: "list" }, id);
    socket.serverClose();
    await expect(interrupted).rejects.toThrow("disconnected");
    expect(connection.schedules).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
  });
  it("does not send schedule requests to an older daemon", async () => {
    const { connection, socket, ready } = startConnection();
    connection.subscribeWorkspace(() => undefined);
    socket.serverOpen();
    socket.serverSend(READY);
    await ready;
    socket.serverSend({ type: "workspace.snapshot", snapshot });
    const count = socket.sent.length;
    await expect(
      connection.requestSchedule({ kind: "list" }, "00000000-0000-4000-8000-000000000003"),
    ).rejects.toThrow("Update the daemon");
    expect(socket.sent).toHaveLength(count);
    connection.disconnect();
  });
});
