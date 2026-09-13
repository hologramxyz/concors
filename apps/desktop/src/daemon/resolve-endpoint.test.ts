import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: false,
  start: vi.fn(),
  env: { daemonUrl: undefined as string | undefined },
}));
vi.mock("../tauri/index.ts", () => ({
  isTauri: () => mocks.native,
  localDaemon: { start: mocks.start },
}));
vi.mock("../config/env.ts", () => ({ env: mocks.env }));
import { resolveStartupEndpoint } from "./resolve-endpoint.ts";

afterEach(() => {
  mocks.native = false;
  mocks.env.daemonUrl = undefined;
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("local startup", () => {
  it("uses the native runtime's assigned port even with a browser override", async () => {
    mocks.native = true;
    mocks.env.daemonUrl = "wss://example.com/ws";
    mocks.start.mockResolvedValue({ state: "running", pid: 123, port: 49123 });
    expect((await resolveStartupEndpoint()).url).toBe("ws://127.0.0.1:49123/ws");
  });
  it("preserves startup failures instead of connecting to an unrelated daemon", async () => {
    mocks.native = true;
    mocks.start.mockRejectedValue(new Error("Runtime failed"));
    await expect(resolveStartupEndpoint()).rejects.toThrow("Runtime failed");
  });
  it("reports an incomplete packaged application", async () => {
    mocks.native = true;
    vi.stubEnv("DEV", false);
    mocks.start.mockResolvedValue({ state: "notBundled" });
    await expect(resolveStartupEndpoint()).rejects.toThrow("missing its local runtime");
  });
  it("retains manual native development and browser connections", async () => {
    mocks.native = true;
    vi.stubEnv("DEV", true);
    mocks.start.mockResolvedValue({ state: "notBundled" });
    expect((await resolveStartupEndpoint()).url).toBe("ws://127.0.0.1:7420/ws");
    mocks.native = false;
    mocks.env.daemonUrl = "wss://example.com/ws";
    expect((await resolveStartupEndpoint()).url).toBe("wss://example.com/ws");
  });
});
