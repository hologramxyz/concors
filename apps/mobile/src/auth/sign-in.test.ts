import { createApiClient, memoryTokenStore } from "@concors/api-client";
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { SignInError, signInWithAuthSession, type SignInPlatform } from "./sign-in";

const CODE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";
const GOOGLE = { method: "google", intent: "sign-up" } as const;

function harness(session: { type: string; url?: string }) {
  const tokens = memoryTokenStore();
  const fetch = vi.fn(async () => Response.json({ token: "tok-mobile" }));
  const api = createApiClient({ baseUrl: "https://api.example", tokenStore: tokens, fetch });
  const opened: { url: string; redirectUrl: string }[] = [];
  const platform: SignInPlatform = {
    scheme: "concors",
    randomBytes: (count) => new Uint8Array(randomBytes(count)),
    sha256: async (input) => new Uint8Array(createHash("sha256").update(input).digest()),
    openAuthSession: async (url, redirectUrl) => {
      opened.push({ url, redirectUrl });
      return session;
    },
  };
  return { api, tokens, fetch, opened, platform };
}

describe("mobile sign-in", () => {
  it("returns to this build's scheme and redeems the code with the matching verifier", async () => {
    const { api, tokens, fetch, opened, platform } = harness({
      type: "success",
      url: `concors://native-auth/callback?code=${CODE}`,
    });
    expect(await signInWithAuthSession(api, platform, GOOGLE)).toBe("signed-in");

    expect(tokens.get()).toBe("tok-mobile");
    const start = new URL(opened[0]!.url);
    expect(start.pathname).toBe("/api/v1/native-auth/start");
    expect(start.searchParams.get("app")).toBe("concors");
    expect(start.searchParams.get("method")).toBe("google");
    expect(start.searchParams.get("intent")).toBe("sign-up");
    expect(opened[0]!.redirectUrl).toBe("concors://native-auth/callback");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { code: string; verifier: string };
    expect(body.code).toBe(CODE);
    expect(createHash("sha256").update(body.verifier).digest("base64url")).toBe(
      start.searchParams.get("challenge"),
    );
  });

  it.each([
    [{ type: "cancel" }],
    [{ type: "dismiss" }],
    [{ type: "success", url: "concors://native-auth/callback?error=access_denied" }],
    [{ type: "success", url: "concors://native-auth/callback?error=cancelled" }],
  ])(
    "treats closing the sheet or cancelling on the sign-in page as a quiet cancel: %o",
    async (session) => {
      const { api, tokens, fetch, platform } = harness(session);
      expect(await signInWithAuthSession(api, platform, GOOGLE)).toBe("cancelled");
      expect(fetch).not.toHaveBeenCalled();
      expect(tokens.get()).toBeNull();
    },
  );

  it("ignores a session that ended anywhere but this app's callback", async () => {
    const { api, fetch, platform } = harness({
      type: "success",
      url: `concors-preview://native-auth/callback?code=${CODE}`,
    });
    expect(await signInWithAuthSession(api, platform, GOOGLE)).toBe("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains an account without a verified email", async () => {
    const { api, tokens, platform } = harness({
      type: "success",
      url: "concors://native-auth/callback?error=email_required",
    });
    const attempt = signInWithAuthSession(api, platform, GOOGLE);
    await expect(attempt).rejects.toBeInstanceOf(SignInError);
    await expect(attempt).rejects.toThrow("no verified email address");
    expect(tokens.get()).toBeNull();
  });
});
