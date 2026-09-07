import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.ts";

describe("parseEnv", () => {
  it("applies defaults", () => {
    expect(parseEnv({})).toEqual({ apiUrl: "http://localhost:3000", daemonUrl: undefined });
  });

  it("reads configured values", () => {
    expect(
      parseEnv({
        VITE_CONCORS_API_URL: "https://api.concors.dev",
        VITE_CONCORS_DAEMON_URL: "wss://remote-daemon.example/ws",
      }),
    ).toEqual({ apiUrl: "https://api.concors.dev", daemonUrl: "wss://remote-daemon.example/ws" });
  });

  it("rejects a malformed API URL", () => {
    expect(() => parseEnv({ VITE_CONCORS_API_URL: "not a url" })).toThrow(/VITE_CONCORS_API_URL/);
  });
});
