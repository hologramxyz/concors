import { afterEach, expect, it, vi } from "vitest";
import { version } from "./package.json";
import eas from "./eas.json";
import listing from "./release/store-listing.json";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("links the registered Expo project by default without changing the app identity", async () => {
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("EXPO_OWNER", undefined);
  vi.stubEnv("EXPO_PUBLIC_EAS_PROJECT_ID", undefined);
  const { default: config } = await import("./app.config");
  expect(config.slug).toBe("concors");
  expect(config.owner).toBe("opser");
  expect(config.extra?.eas?.projectId).toBe("cbfccc75-202c-461c-a19d-46419a248dcd");
  expect(config.name).toBe("Concors");
  expect(config.ios?.bundleIdentifier).toBe("dev.concors.mobile");
});

it("allows explicit Expo project overrides", async () => {
  vi.stubEnv("EXPO_OWNER", "test-team");
  vi.stubEnv("EXPO_PUBLIC_EAS_PROJECT_ID", "12345678-1234-4123-8123-123456789abc");
  const { default: config } = await import("./app.config");
  expect(config.owner).toBe("test-team");
  expect(config.extra?.eas?.projectId).toBe("12345678-1234-4123-8123-123456789abc");
});

it("keeps explicitly unlinked local builds independent of the registered Expo project", async () => {
  vi.stubEnv("EXPO_OWNER", "");
  vi.stubEnv("EXPO_PUBLIC_EAS_PROJECT_ID", "");
  const { default: config } = await import("./app.config");
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas).toBeUndefined();
});

it("uses a separate local Personal Team identity without push or associated domains", async () => {
  vi.stubEnv("APP_VARIANT", "development");
  vi.stubEnv("EAS_BUILD_PROFILE", "");
  vi.stubEnv("EAS_BUILD", "");
  vi.stubEnv("CONCORS_IOS_PERSONAL_TEAM", "true");
  vi.stubEnv("CONCORS_IOS_BUNDLE_IDENTIFIER", "dev.tester.concors");
  vi.stubEnv("CONCORS_IOS_TEAM_ID", "ABC1234567");
  const { default: config } = await import("./app.config");
  expect(config.name).toBe("Concors Dev");
  expect(config.scheme).toBe("concors-local");
  expect(config.ios?.bundleIdentifier).toBe("dev.tester.concors");
  expect(config.ios?.appleTeamId).toBe("ABC1234567");
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.extra?.personalTeam).toBe(true);
  expect(config.plugins).toContain("./plugins/with-personal-team.cjs");
  expect(
    config.plugins?.some(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-notifications",
    ),
  ).toBe(false);
});

it.each([
  { APP_VARIANT: "production" },
  { APP_VARIANT: "preview" },
  { EAS_BUILD_PROFILE: "development" },
  { EAS_BUILD: "true" },
  { CONCORS_IOS_BUNDLE_IDENTIFIER: "dev.concors.mobile" },
  { CONCORS_IOS_BUNDLE_IDENTIFIER: "dev.concors.mobile.preview" },
  { CONCORS_IOS_BUNDLE_IDENTIFIER: "not an identifier" },
  { CONCORS_IOS_TEAM_ID: "wrong" },
])("rejects invalid or non-local Personal Team configuration: %j", async (overrides) => {
  for (const [key, value] of Object.entries({
    APP_VARIANT: "development",
    EAS_BUILD: "",
    EAS_BUILD_PROFILE: "",
    CONCORS_IOS_PERSONAL_TEAM: "true",
    ...overrides,
  }))
    vi.stubEnv(key, value);
  await expect(import("./app.config")).rejects.toThrow();
});

it("keeps candidate builds production-configured and candidate uploads internal-only", () => {
  expect(eas.build.candidate).toMatchObject({
    distribution: "store",
    autoIncrement: true,
    environment: "production",
    env: { APP_VARIANT: "production", EXPO_PUBLIC_DEMO: "false" },
    android: { buildType: "app-bundle" },
  });
  expect(eas.build.production).toEqual({ extends: "candidate" });
  expect(eas.submit.candidate.android).toEqual({ track: "internal", releaseStatus: "draft" });
  expect(eas.submit.candidate.ios).toEqual({ ascAppId: "6812901549" });
  expect(eas.submit.production.ios).toEqual(eas.submit.candidate.ios);
});

it("uses prebuilt Sharp binaries on EAS Mac builders across inherited iOS profiles", () => {
  // Global libvips on the builder otherwise triggers an unnecessary node-gyp build.
  expect(eas.build.base.ios.env.SHARP_IGNORE_GLOBAL_LIBVIPS).toBe("1");
  expect(eas.build.development.extends).toBe("base");
  expect(eas.build.simulator.extends).toBe("development");
  expect(eas.build.preview.extends).toBe("base");
  expect(eas.build.candidate.extends).toBe("base");
  expect(eas.build.production.extends).toBe("candidate");
});

it("uses the production identity for candidates without a development launcher scheme", async () => {
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("EAS_BUILD_PROFILE", "candidate");
  const { default: config } = await import("./app.config");
  expect(config.version).toBe(version);
  expect(config.name).toBe("Concors");
  expect(config.ios?.bundleIdentifier).toBe("dev.concors.mobile");
  expect(config.android?.package).toBe("dev.concors.mobile");
  expect(config.scheme).toBe("concors");
  expect(config.plugins).toContainEqual(["expo-dev-client", { addGeneratedScheme: false }]);
  expect(config.plugins).toContainEqual(["expo-secure-store", { faceIDPermission: false }]);
  expect(config.android?.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
  expect(config.ios?.associatedDomains).toEqual(["applinks:concors.dev"]);
  expect(config.plugins).toContainEqual([
    "expo-splash-screen",
    expect.objectContaining({
      dark: { image: "./assets/splash-dark.png", backgroundColor: "#141414" },
    }),
  ]);
});

it("keeps preview identity separate and rejects misspelled variants", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  const { default: preview } = await import("./app.config");
  expect(preview.name).toBe("Concors Preview");
  expect(preview.ios?.bundleIdentifier).toBe("dev.concors.mobile.preview");
  expect(preview.android?.package).toBe("dev.concors.mobile.preview");
  expect(preview.ios?.associatedDomains).toBeUndefined();
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", "prodution");
  await expect(import("./app.config")).rejects.toThrow("APP_VARIANT must be");
});

it("uses Concors consistently in the store listing", () => {
  expect(listing.name).toBe("Concors");
  expect(listing.description).toContain("with Concors.");
  expect(listing.description).toContain("Concors requires an account");
});

it("supports an opt-in web preview subpath without changing root-hosted builds", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  vi.stubEnv("CONCORS_MOBILE_WEB_BASE_PATH", "");
  expect((await import("./app.config")).default.experiments?.baseUrl).toBeUndefined();
  vi.resetModules();
  vi.stubEnv("CONCORS_MOBILE_WEB_BASE_PATH", "/concors-mobile");
  expect((await import("./app.config")).default.experiments?.baseUrl).toBe("/concors-mobile");
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", "production");
  await expect(import("./app.config")).rejects.toThrow("requires a preview build");
});

it.each([
  "https://other.example",
  "//other.example",
  "/../private",
  "/app?token=secret",
  "/app#hash",
  "/app%2fprivate",
])("rejects ambiguous preview base path %s", async (path) => {
  vi.stubEnv("APP_VARIANT", "preview");
  vi.stubEnv("CONCORS_MOBILE_WEB_BASE_PATH", path);
  await expect(import("./app.config")).rejects.toThrow("absolute URL path");
});
