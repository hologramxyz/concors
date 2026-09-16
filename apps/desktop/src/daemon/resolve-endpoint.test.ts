import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: false,
  start: vi.fn(),
  env: { daemonUrl: undefined as string | undefined, apiUrl: "https://api.concors.dev" },
}));
vi.mock("../tauri/index.ts", () => ({
  isTauri: () => mocks.native,
  localDaemon: { start: mocks.start },
}));
vi.mock("../config/env.ts", () => ({ env: mocks.env }));
import { resolveStartupEndpoint } from "./resolve-endpoint.ts";

const IDENTITY = { origin: "https://api.concors.dev", user: "user_1" } as const;

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
    expect((await resolveStartupEndpoint(IDENTITY)).url).toBe("ws://127.0.0.1:49123/ws");
  });
  it("preserves startup failures instead of connecting to an unrelated daemon", async () => {
    mocks.native = true;
    mocks.start.mockRejectedValue(new Error("Runtime failed"));
    await expect(resolveStartupEndpoint(IDENTITY)).rejects.toThrow("Runtime failed");
  });
  it("reports an incomplete packaged application", async () => {
    mocks.native = true;
    vi.stubEnv("DEV", false);
    mocks.start.mockResolvedValue({ state: "notBundled" });
    await expect(resolveStartupEndpoint(IDENTITY)).rejects.toThrow("missing its local runtime");
  });
  it("starts the bundled runtime for the signed-in account's partition", async () => {
    mocks.native = true;
    mocks.start.mockResolvedValue({ state: "running", pid: 1, port: 49123 });
    await resolveStartupEndpoint(IDENTITY);
    // Without the identity the runtime cannot pick a data partition and would share one database.
    expect(mocks.start).toHaveBeenCalledWith(IDENTITY);
  });
  it("retains manual native development and browser connections", async () => {
    mocks.native = true;
    vi.stubEnv("DEV", true);
    mocks.start.mockResolvedValue({ state: "notBundled" });
    expect((await resolveStartupEndpoint(IDENTITY)).url).toBe("ws://127.0.0.1:7420/ws");
    mocks.native = false;
    mocks.env.daemonUrl = "wss://example.com/ws";
    expect((await resolveStartupEndpoint(IDENTITY)).url).toBe("wss://example.com/ws");
  });
});
