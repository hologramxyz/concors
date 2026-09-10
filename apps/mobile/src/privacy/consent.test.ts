import { describe, expect, it } from "vitest";
import { AI_CONSENT_VERSION, consentRecord, hasAIConsent } from "./consent";

describe("AI sharing consent", () => {
  it("requires explicit, versioned consent for the same account and organization", () => {
    const scope = "cloud:api.example:alice:personal";
    const record = consentRecord(scope);
    expect(hasAIConsent(record, scope)).toBe(true);
    for (const other of ["cloud:api.example:bob:personal", "cloud:api.example:alice:team", ""])
      expect(hasAIConsent(record, other)).toBe(false);
    expect(() => consentRecord("")).toThrow();
  });
  it("fails closed for absent, corrupt, old, future or incomplete records", () => {
    for (const raw of [null, "", "{", "true", "null", "[]", "{}"])
      expect(hasAIConsent(raw, "alice")).toBe(false);
    for (const version of [0, 1, AI_CONSENT_VERSION + 1, String(AI_CONSENT_VERSION)])
      expect(
        hasAIConsent(JSON.stringify({ version, scope: "alice", acceptedAt: new Date() }), "alice"),
      ).toBe(false);
    expect(
      hasAIConsent(
        JSON.stringify({ version: AI_CONSENT_VERSION, scope: "alice", acceptedAt: "invalid" }),
        "alice",
      ),
    ).toBe(false);
  });
});
