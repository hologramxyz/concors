import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { demoMe } from "../demo/fixtures";

const { platform, configuration } = vi.hoisted(() => ({
  platform: { OS: "ios" },
  configuration: {
    apiUrl: "https://api.concors.dev",
    demo: false,
    developmentDaemon: undefined as string | undefined,
  },
}));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../config", () => ({ config: configuration }));
vi.mock("../platform/storage", () => ({ tokenStore: { get: () => null, set: vi.fn() } }));
vi.mock("../demo/server", async () => {
  const { demoMe } = await import("../demo/fixtures");
  return { createDemoServer: () => ({ fetch: async () => Response.json(demoMe) }) };
});
beforeEach(() => {
  vi.resetModules();
  platform.OS = "ios";
  configuration.demo = false;
  configuration.developmentDaemon = undefined;
});
afterEach(() => vi.unstubAllGlobals());

it.each(["ios", "android"])("adds the configured Origin in the actual %s runtime", async (os) => {
  platform.OS = os;
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(demoMe));
  vi.stubGlobal("fetch", request);
  const { api } = await import("./runtime");
  await api.getMe();
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("origin")).toBe(configuration.apiUrl);
});

it("does not synthesize the API Origin in the web runtime", async () => {
  platform.OS = "web";
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(demoMe));
  vi.stubGlobal("fetch", request);
  const { api } = await import("./runtime");
  await api.getMe();
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).has("origin")).toBe(false);
});

it("keeps direct-daemon mode from making cloud requests", async () => {
  configuration.developmentDaemon = "wss://private.example/ws";
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  const { api } = await import("./runtime");
  await expect(api.getMe()).rejects.toBeInstanceOf(Error);
  expect(request).not.toHaveBeenCalled();
});

it("keeps simulated demo requests separate from the live API", async () => {
  configuration.demo = true;
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  const { api } = await import("./runtime");
  // Module resets regenerate the demo's timestamps; its identity is what matters here.
  expect((await api.getMe()).user).toMatchObject({ id: demoMe.user.id, email: demoMe.user.email });
  expect(request).not.toHaveBeenCalled();
});
