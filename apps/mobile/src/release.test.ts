import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { expect, it } from "vitest";

it("allows internal previews but blocks a production build while release gates are open", () => {
  const script = fileURLToPath(new URL("../scripts/production-guard.mjs", import.meta.url));
  const preview = spawnSync(process.execPath, [script], {
    env: { ...process.env, EAS_BUILD_PROFILE: "preview" },
    encoding: "utf8",
  });
  expect(preview.status).toBe(0);
  const production = spawnSync(process.execPath, [script], {
    env: { ...process.env, EAS_BUILD_PROFILE: "production" },
    encoding: "utf8",
  });
  expect(production.status).toBe(1);
  expect(production.stderr).toContain("Not ready for store submission");
  const local = spawnSync(process.execPath, [script], {
    env: { ...process.env, EAS_BUILD_PROFILE: "custom-store", APP_VARIANT: "production" },
    encoding: "utf8",
  });
  expect(local.status).toBe(1);
  expect(local.stderr).toContain("Not ready for store submission");
});

it("selects iOS evidence for EAS iPhone releases without treating Play checks as Apple blockers", () => {
  const script = fileURLToPath(new URL("../scripts/production-guard.mjs", import.meta.url));
  const production = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "ios",
    },
    encoding: "utf8",
  });
  expect(production.status).toBe(1);
  expect(production.stderr).toContain("Physical iPhone");
  expect(production.stderr).toContain("accepted Apple agreements");
  expect(production.stderr).not.toContain("Play verification");
  expect(production.stderr).not.toContain("Android");
});
