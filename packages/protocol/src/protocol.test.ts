import { describe, expect, it } from "vitest";

import {
  ClientHelloMessageSchema,
  DaemonReadyMessageSchema,
  HealthResponseSchema,
  PROTOCOL_VERSION,
  createProtocolError,
  parseClientMessage,
  parseDaemonMessage,
} from "./index.ts";

describe("handshake messages", () => {
  it("accepts a valid client.hello", () => {
    const result = ClientHelloMessageSchema.safeParse({
      type: "client.hello",
      protocolVersion: PROTOCOL_VERSION,
      client: { kind: "desktop", name: "concors-desktop", version: "0.1.0", platform: "linux" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown protocol version", () => {
    const result = ClientHelloMessageSchema.safeParse({
      type: "client.hello",
      protocolVersion: "v999",
      client: { kind: "desktop", name: "concors-desktop", version: "0.1.0" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid daemon.ready", () => {
    const result = DaemonReadyMessageSchema.safeParse({
      type: "daemon.ready",
      protocolVersion: "v1",
      daemonVersion: "0.1.0",
      status: "ready",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a daemon.ready with a non-semver daemon version", () => {
    const result = DaemonReadyMessageSchema.safeParse({
      type: "daemon.ready",
      protocolVersion: "v1",
      daemonVersion: "latest",
      status: "ready",
    });
    expect(result.success).toBe(false);
  });
});

describe("wire parsing helpers", () => {
  it("parses JSON text into a client message", () => {
    const raw = JSON.stringify({
      type: "client.hello",
      protocolVersion: "v1",
      client: { kind: "test", name: "vitest", version: "1.0.0" },
    });
    const result = parseClientMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("client.hello");
    }
  });

  it("does not throw on malformed JSON", () => {
    const result = parseClientMessage("{ not json");
    expect(result.success).toBe(false);
  });

  it("rejects unknown message types", () => {
    const result = parseDaemonMessage({ type: "daemon.unknown" });
    expect(result.success).toBe(false);
  });

  it("parses an error message", () => {
    const result = parseDaemonMessage({
      type: "error",
      error: createProtocolError("INVALID_MESSAGE", "bad payload", { issues: [] }),
    });
    expect(result.success).toBe(true);
  });
});

describe("health response", () => {
  it("matches the documented shape exactly", () => {
    expect(HealthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(HealthResponseSchema.safeParse({ status: "degraded" }).success).toBe(false);
  });
});
