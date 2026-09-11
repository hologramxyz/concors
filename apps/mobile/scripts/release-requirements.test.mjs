import { describe, expect, it } from "vitest";
import { candidateFailures, releaseFailures, requiredGates } from "./release-requirements.mjs";

const environment = {
  APP_VARIANT: "production",
  EXPO_PUBLIC_DEMO: "false",
  EXPO_PUBLIC_API_URL: "https://api.concors.dev",
  EXPO_PUBLIC_EAS_PROJECT_ID: "12345678-1234-4123-8123-123456789abc",
  EXPO_OWNER: "test-team",
};
const complete = () => ({
  schemaVersion: 1,
  appVersion: "0.1.0",
  releaseModel: "existing-account-companion",
  gates: requiredGates.map((id) => ({
    id,
    status: "verified",
    verifiedBy: "Test reviewer",
    verifiedAt: "2026-09-09T12:00:00Z",
    evidence: ["test-fixture-evidence-only"],
  })),
});
describe("evidence-backed release checks", () => {
  it("requires every known gate and does not accept an empty or old boolean checklist", () => {
    expect(releaseFailures(complete(), environment)).toEqual([]);
    for (const value of [null, {}, [], { old: true }, { schemaVersion: 1, gates: [] }])
      expect(releaseFailures(value, environment).length).toBeGreaterThan(0);
    const omitted = complete();
    omitted.gates.pop();
    expect(releaseFailures(omitted, environment)).toContainEqual(
      expect.stringContaining("Missing required"),
    );
  });
  it("rejects unchecked, duplicated, unrecognized and evidence-free claims", () => {
    for (const override of [
      { status: "pending" },
      { verifiedBy: "" },
      { verifiedAt: "bad" },
      { evidence: [] },
    ]) {
      const value = complete();
      Object.assign(value.gates[0], override);
      expect(releaseFailures(value, environment).length).toBeGreaterThan(0);
    }
    const duplicate = complete();
    duplicate.gates.push(duplicate.gates[0]);
    expect(releaseFailures(duplicate, environment)).toContain("Release gate IDs must be unique");
    const unknown = complete();
    unknown.gates.push({ ...unknown.gates[0], id: "invented" });
    expect(releaseFailures(unknown, environment)).toContain("Unknown release gate: invented");
  });
  it("rejects test, private override and mismatched production configuration", () => {
    for (const override of [
      { APP_VARIANT: "preview" },
      { EXPO_PUBLIC_DEMO: undefined },
      { EXPO_PUBLIC_DEMO: "true" },
      { EXPO_PUBLIC_DEV_DAEMON_URL: "wss://private.invalid/ws" },
      { EXPO_PUBLIC_API_URL: "https://localhost" },
      { EXPO_PUBLIC_API_URL: "https://127.0.0.1" },
      { EXPO_PUBLIC_API_URL: "https://10.0.0.1" },
      { EXPO_PUBLIC_API_URL: "https://[::1]" },
      { EXPO_PUBLIC_API_URL: "https://private.tailnet.ts.net" },
      { EXPO_PUBLIC_API_URL: "http://api.concors.dev" },
      { EXPO_PUBLIC_API_URL: "https://api.invalid" },
      { EXPO_PUBLIC_API_URL: "https://api.concors.dev?token=secret" },
      { EXPO_PUBLIC_EAS_PROJECT_ID: "00000000-0000-0000-0000-000000000000" },
      { EXPO_OWNER: "" },
    ])
      expect(releaseFailures(complete(), { ...environment, ...override }).length).toBeGreaterThan(
        0,
      );
  });
  it("allows collecting signed-device evidence without approving submission", () => {
    const readiness = complete();
    readiness.gates = readiness.gates.map((gate) => ({ ...gate, status: "pending", evidence: [] }));
    expect(candidateFailures(readiness, environment, "0.1.0")).toEqual([]);
    expect(releaseFailures(readiness, environment, "0.1.0")).toHaveLength(requiredGates.length);
    expect(
      candidateFailures(readiness, { ...environment, EXPO_PUBLIC_DEMO: "true" }, "0.1.0"),
    ).not.toEqual([]);
  });
  it("ties candidate and release evidence to the actual app version and implemented scope", () => {
    for (const check of [candidateFailures, releaseFailures]) {
      expect(check(complete(), environment, "0.2.0")).toContain(
        "Release evidence must match the mobile package version",
      );
      expect(
        check({ ...complete(), releaseModel: "signup-and-purchasing" }, environment, "0.1.0"),
      ).toContain("Use the implemented existing-account-companion release scope");
    }
  });
});
