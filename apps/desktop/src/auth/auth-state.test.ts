import { ApiError, ApiNetworkError } from "@concors/api-client";
import { describe, expect, it } from "vitest";

import { activeOrganization, describeAuthError, initialOf, interpretProbe } from "./auth-state.ts";

const USER = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};
const SESSION = { id: "s1", expiresAt: "2026-10-07T00:00:00.000Z", activeOrganizationId: "org1" };
const ORG = {
  id: "org1",
  name: "ada",
  slug: "ada",
  logo: null,
  isPersonal: true,
  role: "owner",
  createdAt: "2026-09-07T00:00:00.000Z",
};

describe("interpretProbe", () => {
  it("signs in on success", () => {
    const result = interpretProbe(
      { kind: "ok", me: { user: USER, session: SESSION }, organizations: [ORG] },
      true,
    );
    expect(result).toEqual({
      state: { status: "signed-in", user: USER, session: SESSION, organizations: [ORG] },
      dropToken: false,
    });
  });

  it("drops the token on 401, with or without a saved token", () => {
    const error = new ApiError(401, "Authentication required");
    expect(interpretProbe({ kind: "failed", error }, true)).toEqual({
      state: { status: "signed-out" },
      dropToken: true,
    });
    expect(interpretProbe({ kind: "failed", error }, false)).toEqual({
      state: { status: "signed-out" },
      dropToken: true,
    });
  });

  it("keeps the token and reports the API as unavailable on transport or server failures", () => {
    const offline = interpretProbe(
      { kind: "failed", error: new ApiNetworkError("https://api.example", new TypeError()) },
      true,
    );
    expect(offline.dropToken).toBe(false);
    expect(offline.state).toMatchObject({
      status: "unavailable",
      message: /reach the Concourse API/,
    });

    const broken = interpretProbe({ kind: "failed", error: new ApiError(503, "down") }, true);
    expect(broken.state).toMatchObject({ status: "unavailable", message: /having trouble/ });
  });

  it("reads failures without a saved token as plainly signed out", () => {
    const result = interpretProbe(
      { kind: "failed", error: new ApiNetworkError("https://api.example", new TypeError()) },
      false,
    );
    expect(result).toEqual({ state: { status: "signed-out" }, dropToken: false });
  });
});

describe("describeAuthError", () => {
  it("translates known Better Auth codes", () => {
    expect(describeAuthError(new ApiError(401, "x", "INVALID_EMAIL_OR_PASSWORD"))).toBe(
      "Incorrect email or password.",
    );
    expect(describeAuthError(new ApiError(422, "x", "USER_ALREADY_EXISTS"))).toMatch(/Sign in/);
  });

  it("falls back to the server message for unknown 4xx and hides 5xx details", () => {
    expect(describeAuthError(new ApiError(400, "Slug taken", "INVALID_SLUG"))).toBe("Slug taken");
    expect(describeAuthError(new ApiError(500, "stack trace"))).toMatch(/Try again/);
  });

  it("handles non-API errors", () => {
    expect(describeAuthError(new Error("boom"))).toBe("boom");
    expect(describeAuthError("???")).toBe("Something went wrong.");
  });
});

describe("helpers", () => {
  it("finds the active organization", () => {
    const state = {
      status: "signed-in",
      user: USER,
      session: SESSION,
      organizations: [ORG],
    } as const;
    expect(activeOrganization(state)).toEqual(ORG);
    expect(
      activeOrganization({ ...state, session: { ...SESSION, activeOrganizationId: null } }),
    ).toBeUndefined();
  });

  it("derives an avatar initial from the name, then the email", () => {
    expect(initialOf(USER)).toBe("A");
    expect(initialOf({ ...USER, name: "  " })).toBe("A");
    expect(initialOf({ ...USER, name: "", email: "zed@example.com" })).toBe("Z");
  });
});
