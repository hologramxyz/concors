import { DEFAULT_LOCAL_DAEMON_PORT } from "@concors/protocol";
import { describe, expect, it } from "vitest";

import { InvalidDaemonUrlError, describeDaemonEndpoint, localDaemonEndpoint } from "./endpoint.ts";

describe("describeDaemonEndpoint", () => {
  it("classifies loopback hosts as local", () => {
    expect(describeDaemonEndpoint("ws://127.0.0.1:7420/ws").kind).toBe("local");
    expect(describeDaemonEndpoint("ws://localhost:7420/ws").kind).toBe("local");
    expect(describeDaemonEndpoint("ws://[::1]:7420/ws").kind).toBe("local");
  });

  it("classifies everything else as remote", () => {
    expect(describeDaemonEndpoint("wss://remote-daemon.example/ws").kind).toBe("remote");
    expect(describeDaemonEndpoint("ws://192.168.1.10:7420/ws").kind).toBe("remote");
  });

  it("appends the protocol WebSocket path when none is given", () => {
    expect(describeDaemonEndpoint("wss://remote-daemon.example").url).toBe(
      "wss://remote-daemon.example/ws",
    );
  });

  it("rewrites http(s) to ws(s)", () => {
    expect(describeDaemonEndpoint("http://127.0.0.1:7420").url).toBe("ws://127.0.0.1:7420/ws");
    expect(describeDaemonEndpoint("https://remote-daemon.example").url).toBe(
      "wss://remote-daemon.example/ws",
    );
  });

  it("rejects unsupported schemes and garbage", () => {
    expect(() => describeDaemonEndpoint("ftp://x")).toThrow(InvalidDaemonUrlError);
    expect(() => describeDaemonEndpoint("not a url")).toThrow(InvalidDaemonUrlError);
  });

  it("carries an optional label", () => {
    expect(describeDaemonEndpoint("wss://vps.example", "My VPS").label).toBe("My VPS");
    expect(describeDaemonEndpoint("wss://vps.example")).not.toHaveProperty("label");
  });
});

describe("localDaemonEndpoint", () => {
  it("uses the protocol default port", () => {
    const endpoint = localDaemonEndpoint();
    expect(endpoint.kind).toBe("local");
    expect(endpoint.url).toBe(`ws://127.0.0.1:${DEFAULT_LOCAL_DAEMON_PORT}/ws`);
  });
});
