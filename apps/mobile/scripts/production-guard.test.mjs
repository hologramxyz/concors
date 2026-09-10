import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

// Test a pending release independently of the real checklist's future approval state.
const fixture = mkdtempSync(join(tmpdir(), "concors-release-guard-"));
mkdirSync(join(fixture, "scripts"));
mkdirSync(join(fixture, "release"));
for (const name of ["production-guard.mjs", "release-check.mjs", "release-requirements.mjs"])
  copyFileSync(new URL(name, import.meta.url), join(fixture, "scripts", name));
copyFileSync(new URL("../package.json", import.meta.url), join(fixture, "package.json"));
const readiness = JSON.parse(
  readFileSync(new URL("../release/readiness.json", import.meta.url), "utf8"),
);
readiness.gates = readiness.gates.map((gate) => ({ ...gate, status: "pending", evidence: [] }));
writeFileSync(join(fixture, "release/readiness.json"), JSON.stringify(readiness));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const environment = {
  ...process.env,
  APP_VARIANT: "production",
  EXPO_PUBLIC_DEMO: "false",
  EXPO_PUBLIC_DEV_DAEMON_URL: "",
  EXPO_PUBLIC_API_URL: "https://api.concors.dev",
  EXPO_PUBLIC_EAS_PROJECT_ID: "12345678-1234-4123-8123-123456789abc",
  EXPO_OWNER: "test-team",
};
function guard(overrides) {
  return spawnSync(process.execPath, [join(fixture, "scripts/production-guard.mjs")], {
    env: { ...environment, ...overrides },
    encoding: "utf8",
    timeout: 10_000,
  });
}

it("allows only explicitly named, production-configured candidates before evidence exists", () => {
  const evidence = join(fixture, "release/readiness.json");
  const before = readFileSync(evidence, "utf8");
  const candidate = guard({ EAS_BUILD_PROFILE: "candidate" });
  expect(candidate.status, candidate.stderr).toBe(0);
  expect(candidate.stdout).toContain("Build for testing only");
  for (const override of [
    { EAS_BUILD_PROFILE: "production" },
    { EAS_BUILD_PROFILE: "custom-production" },
    { EAS_BUILD_PROFILE: "" },
    { EAS_BUILD_PROFILE: "candidate", APP_VARIANT: "preview" },
    { EAS_BUILD_PROFILE: "candidate", EXPO_PUBLIC_DEMO: "true" },
    {
      EAS_BUILD_PROFILE: "candidate",
      EXPO_PUBLIC_DEV_DAEMON_URL: "wss://private.tailnet.ts.net/ws",
    },
    { EAS_BUILD_PROFILE: "candidate", EXPO_PUBLIC_EAS_PROJECT_ID: "" },
  ])
    expect(guard(override).status, JSON.stringify(override)).toBe(1);
  expect(readFileSync(evidence, "utf8")).toBe(before);
});

it("keeps standalone previews available and labels candidate reports separately", () => {
  expect(
    guard({ EAS_BUILD_PROFILE: "preview", APP_VARIANT: "preview", EXPO_PUBLIC_DEMO: "true" })
      .status,
  ).toBe(0);
  const report = spawnSync(
    process.execPath,
    [join(fixture, "scripts/release-check.mjs"), "--candidate", "--json"],
    {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(report.status, report.stderr).toBe(0);
  expect(JSON.parse(report.stdout)).toEqual({
    check: "candidate-build",
    ready: true,
    failures: [],
  });
});

it("allows a production build after every submission gate has genuine evidence recorded", () => {
  const path = join(fixture, "release/readiness.json");
  const pending = readFileSync(path, "utf8");
  const complete = JSON.parse(pending);
  complete.gates = complete.gates.map((gate) => ({
    ...gate,
    status: "verified",
    verifiedBy: "Fixture reviewer",
    verifiedAt: "2026-09-10T00:00:00Z",
    evidence: ["test-only-record"],
  }));
  try {
    writeFileSync(path, JSON.stringify(complete));
    const result = guard({ EAS_BUILD_PROFILE: "production" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Recorded release evidence is complete");
  } finally {
    writeFileSync(path, pending);
  }
});
