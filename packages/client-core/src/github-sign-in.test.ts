import { describe, expect, it } from "vitest";

import {
  base64url,
  describeGitHubSignInError,
  parseSignInCallback,
  verifierFromBytes,
} from "./github-sign-in.ts";

const CODE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
/** Independent reference encoder, so the hand-written one is checked against something else. */
const reference = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("base64url", () => {
  it("matches a reference encoder for every length remainder", () => {
    for (let length = 0; length < 70; length++) {
      const bytes = randomBytes(length);
      expect(base64url(bytes)).toBe(reference(bytes));
    }
  });

  it("produces the RFC 7636 appendix B challenge", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    );
    expect(base64url(new Uint8Array(digest))).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds verifiers the API accepts", () => {
    expect(verifierFromBytes(randomBytes(32))).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => verifierFromBytes(randomBytes(16))).toThrow();
  });
});

describe("parseSignInCallback", () => {
  it("reads a code from the mobile scheme and the loopback URL alike", () => {
    expect(parseSignInCallback(`concors://native-auth/callback?code=${CODE}`)).toEqual({
      kind: "code",
      code: CODE,
    });
    expect(parseSignInCallback(`http://127.0.0.1:49152/callback?code=${CODE}#_=_`)).toEqual({
      kind: "code",
      code: CODE,
    });
  });

  it("passes known error codes through", () => {
    expect(parseSignInCallback("concors://native-auth/callback?error=account_not_linked")).toEqual({
      kind: "error",
      error: "account_not_linked",
    });
  });

  it.each([
    "concors://native-auth/callback?code=short",
    "concors://native-auth/callback?error=%3Cscript%3E",
    "concors://native-auth/callback?error=%E0%A4%A",
    "concors://native-auth/callback",
    "",
  ])("reduces anything unexpected to a generic failure: %s", (input) => {
    expect(parseSignInCallback(input)).toEqual({ kind: "error", error: "sign_in_failed" });
  });
});

describe("describeGitHubSignInError", () => {
  it("explains a refused link to a password account", () => {
    expect(describeGitHubSignInError("account_not_linked")).toContain("email and password");
  });

  it("never shows an unknown code", () => {
    expect(describeGitHubSignInError("<script>")).toBe(
      "GitHub sign-in did not complete. Try again.",
    );
  });
});
