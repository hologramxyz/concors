import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient } from "@concors/api-client";
import { HydratedTokenStore } from "@concors/client-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hydrate: vi.fn(), getSignInProviders: vi.fn() }));
vi.mock("./runtime", () => ({
  api: { baseUrl: "https://api.example", getSignInProviders: mocks.getSignInProviders },
}));
vi.mock("../platform/storage", () => ({ tokenStore: { hydrate: mocks.hydrate } }));
import { useSignInProviders } from "./use-sign-in-providers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useSignInProviders>;
let tokens: HydratedTokenStore;
let read: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

function Probe({ enabled }: { enabled: boolean }) {
  const current = useSignInProviders(enabled);
  useEffect(() => {
    result = current;
  }, [current]);
  return null;
}
async function mount(enabled = true) {
  await act(async () => {
    renderer = create(
      createElement(QueryClientProvider, { client }, createElement(Probe, { enabled })),
    );
  });
  await tick();
}
async function tick(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  focusManager.setFocused(true);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  read = vi.fn(async () => null);
  tokens = new HydratedTokenStore({ read, write: async () => undefined });
  fetch = vi.fn(async () => Response.json({ github: true }));
  // Use the real API client and secure-store state machine, not an already-hydrated memory store.
  const api = createApiClient({ baseUrl: "https://api.example", tokenStore: tokens, fetch });
  mocks.hydrate.mockImplementation(() => tokens.hydrate());
  mocks.getSignInProviders.mockImplementation(() => api.getSignInProviders());
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("native sign-in provider discovery", () => {
  it("waits for a signed-out cold-start secure-store read before making the API request", async () => {
    let finishRead!: (token: string | null) => void;
    read.mockImplementation(() => new Promise((resolve) => (finishRead = resolve)));
    expect(() => tokens.get()).toThrow("Session storage is still loading");
    await mount();
    expect(result.checking).toBe(true);
    expect(mocks.getSignInProviders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    finishRead(null);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(true);
    expect(result.checking).toBe(false);
    expect(result.error).toBeNull();
  });

  it("also discovers GitHub when a saved session is hydrated", async () => {
    read.mockResolvedValue("saved-test-session");
    await mount();
    expect(result.available).toBe(true);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer saved-test-session",
    );
  });

  it("retries a transient network failure without restarting the app", async () => {
    fetch.mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(result.checking).toBe(true);
    expect(result.available).toBe(false);
    await tick(1_100);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.available).toBe(true);
  });

  it("retries a temporarily unavailable secure store before touching the API", async () => {
    read.mockRejectedValueOnce(new Error("Keychain locked"));
    await mount();
    expect(fetch).not.toHaveBeenCalled();
    await tick(1_100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.available).toBe(true);
  });

  it("surfaces exhausted failures and lets the user retry", async () => {
    fetch.mockRejectedValue(new Error("Offline"));
    await mount();
    await tick(3_100);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.available).toBe(false);
    expect(result.checking).toBe(false);
    expect(result.error).toContain("You can still sign in with email");
    fetch.mockResolvedValue(Response.json({ github: true }));
    await act(async () => result.retry());
    await tick();
    expect(result.available).toBe(true);
    expect(result.error).toBeNull();
  });

  it("rechecks after returning to the foreground following an exhausted failure", async () => {
    fetch.mockRejectedValue(new Error("Offline"));
    await mount();
    await tick(3_100);
    fetch.mockResolvedValue(Response.json({ github: true }));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await tick();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.available).toBe(true);
    expect(result.error).toBeNull();
  });

  it("does not treat a deliberately disabled server provider as an error", async () => {
    fetch.mockImplementation(async () => Response.json({ github: false }));
    await mount();
    expect(result.available).toBe(false);
    expect(result.error).toBeNull();
    expect(result.checking).toBe(false);
    await tick(4_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a known GitHub button visible during a failed background refresh", async () => {
    await mount();
    fetch.mockRejectedValue(new Error("Offline"));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await tick(3_100);
    expect(result.available).toBe(true);
    expect(result.checking).toBe(false);
    expect(result.error).toBeNull();
  });

  it("does not discover providers in unsupported builds, including explicit retry", async () => {
    await mount(false);
    await act(async () => result.retry());
    expect(result.available).toBe(false);
    expect(result.checking).toBe(false);
    expect(result.error).toBeNull();
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
