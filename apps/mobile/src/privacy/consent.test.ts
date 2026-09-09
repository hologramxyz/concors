import { describe, expect, it } from "vitest";
import { consentRecord, hasAIConsent } from "./consent";

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
    for (const version of [0, 2, "1"])
      expect(
        hasAIConsent(JSON.stringify({ version, scope: "alice", acceptedAt: new Date() }), "alice"),
      ).toBe(false);
    expect(hasAIConsent('{"version":1,"scope":"alice","acceptedAt":"invalid"}', "alice")).toBe(
      false,
    );
  });
});
