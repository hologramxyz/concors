import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { ProfileError, profileKey, resolveDataDir, resolvedDataDirEnv } from "./profile.ts";

const DEV = "https://concors-server-dev.up.railway.app";
const PROD = "https://api.concors.dev";

describe("profileKey", () => {
  it("is stable for the same identity", () => {
    expect(profileKey(PROD, "user_1")).toBe(profileKey(PROD, "user_1"));
  });

  it("separates users on one control plane", () => {
    expect(profileKey(PROD, "user_1")).not.toBe(profileKey(PROD, "user_2"));
  });

  it("separates development from production for the same user id", () => {
    // Separate control planes are separate databases and may mint the same subject.
    expect(profileKey(DEV, "user_1")).not.toBe(profileKey(PROD, "user_1"));
  });

  it("ignores origin case, path and trailing slash", () => {
    const expected = profileKey(PROD, "user_1");
    expect(profileKey("https://API.Concors.dev", "user_1")).toBe(expected);
    expect(profileKey("https://api.concors.dev/", "user_1")).toBe(expected);
    expect(profileKey("https://api.concors.dev/api/v1", "user_1")).toBe(expected);
  });

  it("distinguishes ports and schemes", () => {
    expect(profileKey("http://localhost:3000", "u")).not.toBe(
      profileKey("http://localhost:3001", "u"),
    );
    expect(profileKey("https://localhost:3000", "u")).not.toBe(
      profileKey("http://localhost:3000", "u"),
    );
  });

  it("does not let a boundary shift collide two identities", () => {
    expect(profileKey("https://a.dev", "bc")).not.toBe(profileKey("https://a.dev", "b\nc"));
  });

  it("produces a safe path segment", () => {
    expect(profileKey(PROD, "../../etc/passwd")).toMatch(/^[a-f0-9]{16}$/);
  });

  it("rejects input it cannot key", () => {
    expect(() => profileKey("not a url", "user_1")).toThrow(ProfileError);
    expect(() => profileKey("ftp://api.concors.dev", "user_1")).toThrow(ProfileError);
    expect(() => profileKey(PROD, "  ")).toThrow(ProfileError);
  });
});

describe("resolveDataDir", () => {
  it("stays unpartitioned when no identity is configured", () => {
    expect(resolveDataDir({ CONCORS_DATA_DIR: "/data" })).toBe("/data");
  });

  it("nests the profile inside an explicit base directory", () => {
    const dir = resolveDataDir({
      CONCORS_DATA_DIR: "/data",
      CONCORS_PROFILE_ORIGIN: PROD,
      CONCORS_PROFILE_USER: "user_1",
    });
    expect(dir).toBe(join("/data", "profiles", profileKey(PROD, "user_1")));
  });

  it("needs both halves of the identity before partitioning", () => {
    expect(resolveDataDir({ CONCORS_DATA_DIR: "/data", CONCORS_PROFILE_USER: "user_1" })).toBe(
      "/data",
    );
    expect(resolveDataDir({ CONCORS_DATA_DIR: "/data", CONCORS_PROFILE_ORIGIN: PROD })).toBe(
      "/data",
    );
  });

  it("gives development and production separate directories", () => {
    const base = { CONCORS_DATA_DIR: "/data", CONCORS_PROFILE_USER: "user_1" };
    expect(resolveDataDir({ ...base, CONCORS_PROFILE_ORIGIN: DEV })).not.toBe(
      resolveDataDir({ ...base, CONCORS_PROFILE_ORIGIN: PROD }),
    );
  });
});

describe("resolvedDataDirEnv", () => {
  it("stops a child from partitioning an already-resolved directory again", () => {
    // Leaving these set makes the child serve a nested profile the parent never waits on.
    const child = resolvedDataDirEnv("/data/profiles/abc", {
      CONCORS_DATA_DIR: "/data",
      CONCORS_PROFILE_ORIGIN: PROD,
      CONCORS_PROFILE_USER: "user_1",
    });
    expect(child["CONCORS_DATA_DIR"]).toBe("/data/profiles/abc");
    expect(child["CONCORS_PROFILE_ORIGIN"]).toBeUndefined();
    expect(child["CONCORS_PROFILE_USER"]).toBeUndefined();
    expect(resolveDataDir(child)).toBe("/data/profiles/abc");
  });

  it("keeps the rest of the environment intact", () => {
    expect(resolvedDataDirEnv("/data", { PATH: "/usr/bin" })["PATH"]).toBe("/usr/bin");
  });
});
