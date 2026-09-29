import { createApiClient, memoryTokenStore } from "@concors/api-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/tauri", () => ({
  isTauri: () => true,
  openExternal: vi.fn(),
  startSignInListener: vi.fn(),
}));

import {
  challengeFor,
  createVerifier,
  SignInError,
  signInWithBrowser,
  type SignInDependencies,
} from "./sign-in.ts";
import type { SignInCallback } from "@/tauri";

const GITHUB = { method: "github", intent: "sign-in" } as const;

function harness(
  callback: SignInCallback,
  exchange = () => Response.json({ token: "tok-native" }),
) {
  const tokens = memoryTokenStore();
  const fetch = vi.fn(async () => exchange());
  const api = createApiClient({ baseUrl: "https://api.example", tokenStore: tokens, fetch });
  let resolve: (value: SignInCallback) => void = () => undefined;
  const cancel = vi.fn(() => resolve({ kind: "error", error: "cancelled" }));
  const opened: string[] = [];
  const dependencies: SignInDependencies = {
    startListener: async () => ({
      port: 49152,
      result: new Promise<SignInCallback>((settle) => {
        resolve = settle;
      }),
      cancel,
    }),
    openExternal: async (url) => {
      opened.push(url);
      queueMicrotask(() => resolve(callback));
    },
  };
  return { api, tokens, fetch, cancel, opened, dependencies };
}

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates verifiers the API accepts, never repeating", () => {
    const verifier = createVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createVerifier()).not.toBe(verifier);
  });
});

describe("signInWithBrowser", () => {
  it("opens the browser with this attempt's challenge and redeems the code with its verifier", async () => {
    const { api, tokens, fetch, opened, dependencies } = harness({
      kind: "code",
      code: "k".repeat(43),
    });
    await signInWithBrowser(api, GITHUB, undefined, dependencies);

    expect(tokens.get()).toBe("tok-native");
    const start = new URL(opened[0]!);
    expect(start.pathname).toBe("/api/v1/native-auth/start");
    expect(start.searchParams.get("port")).toBe("49152");
    expect(start.searchParams.get("method")).toBe("github");
    expect(start.searchParams.get("intent")).toBe("sign-in");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { code: string; verifier: string };
    expect(body.code).toBe("k".repeat(43));
    // The verifier sent at the end must be the one whose challenge opened the browser.
    expect(await challengeFor(body.verifier)).toBe(start.searchParams.get("challenge"));
  });

  it("explains an account without a verified email and stores nothing", async () => {
    const { api, tokens, fetch, dependencies } = harness({
      kind: "error",
      error: "email_required",
    });
    const attempt = signInWithBrowser(api, GITHUB, undefined, dependencies);
    await expect(attempt).rejects.toBeInstanceOf(SignInError);
    await expect(attempt).rejects.toThrow("no verified email address");
    expect(fetch).not.toHaveBeenCalled();
    expect(tokens.get()).toBeNull();
  });

  it("stops listening when cancelled", async () => {
    const { api, cancel, dependencies } = harness({ kind: "code", code: "k".repeat(43) });
    const controller = new AbortController();
    dependencies.openExternal = async () => controller.abort();
    await expect(signInWithBrowser(api, GITHUB, controller.signal, dependencies)).rejects.toThrow(
      "cancelled",
    );
    expect(cancel).toHaveBeenCalled();
  });

  it("releases the port even when the browser cannot be opened", async () => {
    const { api, cancel, dependencies } = harness({ kind: "code", code: "k".repeat(43) });
    dependencies.openExternal = async () => {
      throw new Error("no browser");
    };
    await expect(signInWithBrowser(api, GITHUB, undefined, dependencies)).rejects.toThrow(
      "no browser",
    );
    expect(cancel).toHaveBeenCalled();
  });
});
