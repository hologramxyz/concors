import { describe, expect, it } from "vitest";

import { parseCli } from "./cli.ts";

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
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseCli(["serve", "--bogus"])).toThrow();
  });
});
