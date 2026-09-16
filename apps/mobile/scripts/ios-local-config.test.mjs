import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { localIosEnvironment } from "./ios-local-environment.mjs";

it("omits paid-only local entitlements without changing production capabilities", () => {
  const local = localIosEnvironment({ ...process.env, EAS_BUILD: "", EAS_BUILD_PROFILE: "" });
  const read = (env) => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../node_modules/expo/bin/cli", import.meta.url)),
        "config",
        "--type",
        "introspect",
        "--json",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  const config = read(local);
  const ios = config._internal.modResults.ios;
  expect(config.ios.bundleIdentifier).toBe("dev.concors.mobile.local");
  expect(ios.entitlements["aps-environment"]).toBeUndefined();
  expect(ios.entitlements["com.apple.developer.associated-domains"]).toBeUndefined();
  expect(ios.infoPlist.UIBackgroundModes ?? []).not.toContain("remote-notification");
  expect(ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
  const production = read({
    ...local,
    CONCORS_IOS_PERSONAL_TEAM: "false",
    APP_VARIANT: "production",
  });
  expect(production.ios.bundleIdentifier).toBe("dev.concors.mobile");
  expect(production._internal.modResults.ios.entitlements["aps-environment"]).toBeDefined();
  expect(
    production._internal.modResults.ios.entitlements["com.apple.developer.associated-domains"],
  ).toEqual(["applinks:concors.dev"]);
}, 65_000);
