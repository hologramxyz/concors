import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

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
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./production-guard.mjs", import.meta.url))],
    {
      env: { ...environment, ...overrides },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

it("allows only explicitly named, production-configured candidates before evidence exists", () => {
  const evidence = new URL("../release/readiness.json", import.meta.url);
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
    [fileURLToPath(new URL("./release-check.mjs", import.meta.url)), "--candidate", "--json"],
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
