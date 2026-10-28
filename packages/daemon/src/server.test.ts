import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import {
  HEALTH_PATH,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  WS_PATH,
  parseDaemonMessage,
  type ClientInfo,
  type DaemonMessage,
} from "@concors/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WsClient } from "ws";

import { loadDaemonConfig } from "./config.ts";
import { createDaemonServer, type DaemonServer } from "./server.ts";
import { DAEMON_VERSION } from "./version.ts";

const client: ClientInfo = { kind: "test", name: "daemon-tests", version: "0.0.0" };

let server: DaemonServer;
let baseUrl: string;

beforeEach(async () => {
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
  baseUrl = await server.listen();
});

afterEach(async () => {
  await server.close();
});

/** Opens a raw socket and resolves with the first daemon message (or the close event). */
function rawHandshake(
  payload: unknown,
): Promise<{ message: DaemonMessage | undefined; closeCode: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}${WS_PATH}`);
    let message: DaemonMessage | undefined;
    socket.addEventListener("open", () => {
      if (payload !== undefined) {
        socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
      }
    });
    socket.addEventListener("message", (event) => {
      const parsed = parseDaemonMessage(String(event.data));
      if (parsed.success) message = parsed.data;
    });
    socket.addEventListener("close", (event) => resolve({ message, closeCode: event.code }));
    socket.addEventListener("error", () => reject(new Error("socket error")));
  });
}

describe("GET /health", () => {
  it("returns exactly { status: 'ok' }", async () => {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("connection heartbeat", () => {
  it("sends a heartbeat after the handshake, and keeps a client that answers pings", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}${WS_PATH}`);
      const messages: string[] = [];
      let closed = false;
      socket.addEventListener("message", (event) => {
        const parsed = parseDaemonMessage(String(event.data));
        if (parsed.success) messages.push(parsed.data.type);
      });
      socket.addEventListener("close", () => {
        closed = true;
      });
      await new Promise((resolve) => socket.addEventListener("open", resolve));
      socket.send(
        JSON.stringify({ type: "client.hello", protocolVersion: PROTOCOL_VERSION, client }),
      );
      await vi.waitFor(() => expect(messages).toContain("daemon.ready"));
      // Nothing but the handshake until the first interval: a client still handshaking would
      // reject a message it does not know.
      expect(messages).toEqual(["daemon.ready"]);
      for (let beat = 1; beat <= 3; beat++) {
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
        await vi.waitFor(() =>
          expect(messages.filter((type) => type === "daemon.heartbeat")).toHaveLength(beat),
        );
      }
      // The client's WebSocket answers each ping, so the daemon keeps the connection.
      expect(closed).toBe(false);
      socket.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a connection whose client stops answering pings", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      // A client that died without closing never answers a ping.
      const socket = new WsClient(`${baseUrl.replace(/^http/, "ws")}${WS_PATH}`, {
        autoPong: false,
      });
      const types: string[] = [];
      socket.on("message", (data) => {
        const parsed = parseDaemonMessage(String(data));
        if (parsed.success) types.push(parsed.data.type);
      });
      const closed = new Promise((resolve) => socket.on("close", resolve));
      await new Promise((resolve) => socket.on("open", resolve));
      socket.send(
        JSON.stringify({ type: "client.hello", protocolVersion: PROTOCOL_VERSION, client }),
      );
      await vi.waitFor(() => expect(types).toContain("daemon.ready"));
      for (let beat = 0; beat < 3; beat++) vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      await closed;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WebSocket handshake", () => {
  it("completes end-to-end through DaemonConnection", async () => {
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint(baseUrl),
      client,
    });
    try {
      const info = await connection.connect();
      expect(info).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        daemonVersion: DAEMON_VERSION,
        status: "ready",
        capabilities: [
          "agent-schedules-v1",
          "host-usage",
          "machine-resources",
          "preview-names",
          "terminal-profiles",
          "color-themes",
          "project-files",
          "project-icons",
          "file-previews",
          "file-downloads",
          "file-range-downloads",
          "heartbeat",
          "machine-mcp-servers",
          "machine-plugins",
          "workspace-pull-requests",
          "pull-request-actions",
          "pull-request-states",
          "project-file-create",
          "folder-workspaces",
          "agent-chat",
          "agent-resume-sessions",
          "agent-message-navigation",
          "agent-accounts",
          "agent-attention",
          "agent-plan-usage",
          "agent-composer",
          "agent-queue",
          "agent-queue-steer",
          "agent-providers",
          "provider-settings",
          "provider-subscriptions",
          "provider-plan-usage",
          "agent-native-controls",
          "agent-plan-implementation",
          "pane-rearrangement",
          "workspace-pane-rearrangement",
          "directional-pane-split",
          "pane-rename",
          "project-rename",
          "terminal-recovery",
          "terminal-image-paste",
          "terminal-bind-new-tab",
          "attachment-uploads",
        ],
      });
      expect(connection.state.status).toBe("ready");
    } finally {
      connection.disconnect();
    }
  });

  it("rejects an unsupported protocol version with a structured error", async () => {
    const { message, closeCode } = await rawHandshake({
      type: "client.hello",
      protocolVersion: "v42",
      client,
    });
    expect(message).toMatchObject({
      type: "error",
      error: { code: "PROTOCOL_VERSION_UNSUPPORTED", details: { supported: ["v1"] } },
    });
    expect(closeCode).toBe(1002);
  });

  it("rejects malformed first messages", async () => {
    const { message, closeCode } = await rawHandshake("this is not json");
    expect(message).toMatchObject({ type: "error", error: { code: "INVALID_MESSAGE" } });
    expect(closeCode).toBe(1002);
  });

  it("drops clients that never say hello", async () => {
    // Only this test needs a short deadline. Real handshakes use the production
    // default so a busy runner cannot time out before validating the payload.
    await server.close();
    server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
      handshakeTimeoutMs: 100,
    });
    baseUrl = await server.listen();
    const { message, closeCode } = await rawHandshake(undefined);
    expect(message).toMatchObject({ type: "error", error: { code: "HANDSHAKE_TIMEOUT" } });
    expect(closeCode).toBe(1002);
  });

  it("closes live connections on shutdown", async () => {
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint(baseUrl),
      client,
    });
    await connection.connect();

    const disconnected = new Promise<void>((resolve) => {
      connection.subscribe((state) => {
        if (state.status === "disconnected") resolve();
      });
    });

    await server.close();
    await disconnected;
    expect(connection.state).toMatchObject({ status: "disconnected" });
  });
});
