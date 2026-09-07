import { DEFAULT_LOCAL_DAEMON_PORT } from "@concors/protocol";
import { describe, expect, it } from "vitest";

import { DaemonConfigError, loadDaemonConfig } from "./config.ts";

describe("loadDaemonConfig", () => {
  it("falls back to loopback defaults", () => {
    expect(loadDaemonConfig({}, {})).toEqual({
      host: "127.0.0.1",
      port: DEFAULT_LOCAL_DAEMON_PORT,
      logLevel: "info",
    });
  });

  it("reads environment variables", () => {
    const config = loadDaemonConfig(
      {},
      {
        CONCORS_DAEMON_HOST: "0.0.0.0",
        CONCORS_DAEMON_PORT: "9000",
        CONCORS_DAEMON_LOG_LEVEL: "debug",
      },
    );
    expect(config).toEqual({ host: "0.0.0.0", port: 9000, logLevel: "debug" });
  });

  it("prefers explicit overrides over the environment", () => {
    const config = loadDaemonConfig({ port: "8080" }, { CONCORS_DAEMON_PORT: "9000" });
    expect(config.port).toBe(8080);
  });

  it("rejects invalid values with a readable error", () => {
    expect(() => loadDaemonConfig({ port: "not-a-port" }, {})).toThrow(DaemonConfigError);
    expect(() => loadDaemonConfig({ port: "70000" }, {})).toThrow(/port/);
    expect(() => loadDaemonConfig({ logLevel: "loud" }, {})).toThrow(/logLevel/);
  });
});
