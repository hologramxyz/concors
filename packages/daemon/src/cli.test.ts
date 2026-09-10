import { describe, expect, it, vi } from "vitest";

import { main, parseCli } from "./cli.ts";

describe("parseCli", () => {
  it("parses --version", () => {
    expect(parseCli(["--version"]).version).toBe(true);
    expect(parseCli(["-v"]).version).toBe(true);
  });

  it("parses serve with options", () => {
    expect(
      parseCli(["serve", "--host", "0.0.0.0", "--port", "9000", "--log-level", "debug"]),
    ).toEqual({
      command: "serve",
      version: false,
      help: false,
      host: "0.0.0.0",
      port: "9000",
      logLevel: "debug",
      ephemeral: false,
      managedConfig: undefined,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseCli(["serve", "--bogus"])).toThrow();
  });
});

it("parses managed config", () => {
  expect(parseCli(["serve", "--managed-config", "/etc/concors/daemon.json"]).managedConfig).toBe(
    "/etc/concors/daemon.json",
  );
});

it("uses the managed-config environment variable and gives the flag precedence", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("CONCORS_DAEMON_MANAGED_CONFIG", "/missing/env-daemon.json");
  try {
    expect(await main(["serve"])).toBe(2);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining("/missing/env-daemon.json"));
    expect(await main(["serve", "--managed-config", "/missing/flag-daemon.json"])).toBe(2);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining("/missing/flag-daemon.json"));
    expect(await main(["serve", "--ephemeral"])).toBe(2);
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining("cannot be combined"));
  } finally {
    vi.unstubAllEnvs();
    error.mockRestore();
  }
});
