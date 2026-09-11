import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import {
  HEALTH_PATH,
  PROTOCOL_VERSION,
  WS_PATH,
  parseDaemonMessage,
  type ClientInfo,
  type DaemonMessage,
} from "@concors/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
          "host-usage",
          "terminal-profiles",
          "color-themes",
          "project-files",
          "project-file-create",
          "folder-workspaces",
          "agent-chat",
          "agent-accounts",
          "agent-attention",
          "agent-composer",
          "agent-queue",
          "agent-providers",
          "provider-settings",
          "agent-native-controls",
          "agent-plan-implementation",
          "pane-rearrangement",
          "workspace-pane-rearrangement",
          "directional-pane-split",
          "terminal-recovery",
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
