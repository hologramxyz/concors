import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { developmentApi, localIosEnvironment } from "./ios-local-environment.mjs";

it("uses the approved dev backend and overrides stale TestFlight/demo environment values", () => {
  const original = {
    APP_VARIANT: "production",
    EXPO_PUBLIC_API_URL: "https://wrong.example",
    EXPO_PUBLIC_DEMO: "true",
    EXPO_PUBLIC_DEV_DAEMON_URL: "wss://private.tailnet.ts.net/ws",
    EXPO_PUBLIC_EAS_PROJECT_ID: "old-project",
    EXPO_OWNER: "old-owner",
    CONCORS_MOBILE_WEB_BASE_PATH: "/preview",
    CONCORS_IOS_TEAM_ID: "ABC1234567",
  };
  const before = { ...original };
  expect(localIosEnvironment(original)).toMatchObject({
    APP_VARIANT: "development",
    EXPO_PUBLIC_API_URL: developmentApi,
    EXPO_PUBLIC_DEMO: "false",
    EXPO_PUBLIC_DEV_DAEMON_URL: "",
    EXPO_PUBLIC_EAS_PROJECT_ID: "",
    EXPO_OWNER: "",
    EXPO_NO_DOTENV: "1",
    CONCORS_MOBILE_WEB_BASE_PATH: "",
    CONCORS_IOS_PERSONAL_TEAM: "true",
    CONCORS_IOS_TEAM_ID: "ABC1234567",
  });
  expect(original).toEqual(before);
});
it("normalizes an explicit local-only backend override", () => {
  expect(
    localIosEnvironment({ CONCORS_IOS_API_URL: `${developmentApi}/` }).EXPO_PUBLIC_API_URL,
  ).toBe(developmentApi);
});
it.each([
  "http://localhost:3000",
  "https://secret@example.com",
  "https://example.com?token=secret",
  "https://example.com/#fragment",
  "bad-url",
])("rejects unsafe local API input: %s", (url) => {
  expect(() => localIosEnvironment({ CONCORS_IOS_API_URL: url })).toThrow(
    "must be an HTTPS API URL",
  );
});
it.each([
  { EAS_BUILD: "true" },
  { EAS_BUILD_PROFILE: "candidate" },
  { EAS_BUILD_PROFILE: "development" },
])("does not bypass a cloud build profile: %j", (environment) => {
  expect(() => localIosEnvironment(environment)).toThrow("not inside EAS Build");
});
it.skipIf(process.platform === "darwin")(
  "fails clearly on non-Mac hosts before generating native files",
  () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("ios-local.mjs", import.meta.url))],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires macOS and Xcode");
    expect(result.stdout).toBe("");
  },
);
