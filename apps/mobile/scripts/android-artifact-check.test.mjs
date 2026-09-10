import { expect, it } from "vitest";
import {
  artifactArchitectures,
  elfSupports16KB,
  manifestFailures,
} from "./android-artifact-check.mjs";

it("rejects old or missing target SDK and unintended sensitive permissions", () => {
  expect(
    manifestFailures(
      "targetSdkVersion:'36'",
      "uses-permission: name='android.permission.INTERNET'",
    ),
  ).toEqual([]);
  expect(manifestFailures("targetSdkVersion:'35'", "")).toHaveLength(1);
  expect(manifestFailures("", "")).toHaveLength(1);
  expect(
    manifestFailures(
      "targetSdkVersion:'36'",
      "uses-permission: name='android.permission.RECORD_AUDIO'",
    ),
  ).toHaveLength(1);
});
it("requires all ELF load segments to support 16 KB pages", () => {
  expect(
    elfSupports16KB("  LOAD 0x0 0x0 0x0 0x100 R E 0x4000\n LOAD 0x4000 0x0 0x0 0x10 RW 0x4000"),
  ).toBe(true);
  expect(elfSupports16KB(" LOAD 0x0 0x0 0x0 0x100 R E 0x1000")).toBe(false);
  expect(
    elfSupports16KB(" LOAD 0x0 0x0 0x0 0x100 R E 0x4000\n LOAD 0x0 0x0 0x0 0x10 RW 0x1000"),
  ).toBe(false);
  expect(elfSupports16KB("invalid")).toBe(false);
});

it("requires both release architectures by default and allows explicit simulator audits", () => {
  expect(artifactArchitectures()).toEqual(["arm64-v8a", "x86_64"]);
  expect(artifactArchitectures("x86_64")).toEqual(["x86_64"]);
  expect(() => artifactArchitectures("")).toThrow();
  expect(() => artifactArchitectures("x86_64,armeabi-v7a")).toThrow();
});
