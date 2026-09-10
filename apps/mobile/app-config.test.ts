import { afterEach, expect, it, vi } from "vitest";
import { version } from "./package.json";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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
  expect(config.android?.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
  expect(config.ios?.associatedDomains).toEqual(["applinks:concors.dev"]);
});

it("keeps preview identity separate and rejects misspelled variants", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  const { default: preview } = await import("./app.config");
  expect(preview.ios?.bundleIdentifier).toBe("dev.concors.mobile.preview");
  expect(preview.android?.package).toBe("dev.concors.mobile.preview");
  expect(preview.ios?.associatedDomains).toBeUndefined();
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", "prodution");
  await expect(import("./app.config")).rejects.toThrow("APP_VARIANT must be");
});
