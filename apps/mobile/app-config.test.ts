import { afterEach, expect, it, vi } from "vitest";
import { version } from "./package.json";
import eas from "./eas.json";
import listing from "./release/store-listing.json";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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
  expect(eas.submit.candidate.ios).toEqual({});
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
