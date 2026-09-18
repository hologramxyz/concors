import type { DesktopUpdate } from "@concors/api-client";
import { describe, expect, it, vi } from "vitest";

import type { InstallationReport } from "@/tauri";

import {
  applyUpdate,
  CHECK_INTERVAL_MS,
  findUpdate,
  FOCUS_THROTTLE_MS,
  shouldCheckOnFocus,
  updateQuery,
  type AppUpdateDependencies,
} from "./app-update.ts";

const UPDATE: DesktopUpdate = {
  version: "0.2.0",
  publishedAt: "2026-09-17T12:00:00Z",
  notes: "Faster terminals.",
  url: "https://api.concors.dev/api/v1/releases/desktop/assets/concors-bin-0.2.0-1-x86_64.pkg.tar.zst",
  signature: "",
  format: "pacman",
  size: 48_765_146,
  sha256: "b".repeat(64),
};

const report = (over: Partial<InstallationReport> = {}): InstallationReport =>
  ({
    kind: "pacman",
    package: "concors-bin",
    formats: ["pacman"],
    platform: "linux",
    arch: "x86_64",
    ...over,
  }) as InstallationReport;

function dependencies(over: Partial<AppUpdateDependencies> = {}): AppUpdateDependencies {
  return {
    installation: () => Promise.resolve(report()),
    check: () => Promise.resolve(UPDATE),
    install: () => Promise.resolve(),
    token: () => "session-token",
    version: "0.1.0",
    ...over,
  };
}

describe("updateQuery", () => {
  it("asks for what a packaged copy can install", () => {
    expect(updateQuery(report())).toEqual({ formats: ["pacman"], installable: true });
  });

  it("asks nothing for a build made from a checkout", () => {
    expect(updateQuery(report({ kind: "development", formats: [] }))).toEqual({
      formats: [],
      installable: false,
    });
  });

  it("still asks for an installation it cannot write to, to be able to say so", () => {
    expect(
      updateQuery(report({ kind: "tarball", root: "/opt/Concors", writable: false, formats: [] })),
    ).toEqual({ formats: ["tarball"], installable: false });
    expect(updateQuery(report({ kind: "unknown", formats: [] }))).toEqual({
      formats: ["tarball"],
      installable: false,
    });
  });
});

describe("findUpdate", () => {
  it("asks about this copy's version, platform and formats", async () => {
    const check = vi.fn(() => Promise.resolve(UPDATE));

    const found = await findUpdate(dependencies({ check }));

    expect(check).toHaveBeenCalledWith({
      version: "0.1.0",
      platform: "linux",
      arch: "x86_64",
      formats: ["pacman"],
    });
    expect(found).toEqual({ update: UPDATE, installable: true });
  });

  it("says nothing when the control plane has nothing newer", async () => {
    await expect(
      findUpdate(dependencies({ check: () => Promise.resolve(null) })),
    ).resolves.toBeNull();
  });

  it("never checks from a development build", async () => {
    const check = vi.fn(() => Promise.resolve(UPDATE));

    const found = await findUpdate(
      dependencies({
        installation: () => Promise.resolve(report({ kind: "development", formats: [] })),
        check,
      }),
    );

    expect(found).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("reports an update it cannot apply as something to act on manually", async () => {
    const found = await findUpdate(
      dependencies({
        installation: () => Promise.resolve(report({ kind: "unknown", formats: [] })),
        check: () => Promise.resolve({ ...UPDATE, format: "tarball" }),
      }),
    );

    expect(found).toMatchObject({ installable: false });
  });

  it("stays quiet when the check fails rather than interrupting", async () => {
    await expect(
      findUpdate(dependencies({ check: () => Promise.reject(new Error("offline")) })),
    ).resolves.toBeNull();
    await expect(
      findUpdate(dependencies({ installation: () => Promise.reject(new Error("no shell")) })),
    ).resolves.toBeNull();
  });
});

describe("applyUpdate", () => {
  it("hands the native side the build, its digest and a session token", async () => {
    const install = vi.fn(() => Promise.resolve());

    await applyUpdate(dependencies({ install }), UPDATE);

    expect(install).toHaveBeenCalledWith({
      url: UPDATE.url,
      sha256: UPDATE.sha256,
      format: "pacman",
      token: "session-token",
      version: "0.2.0",
    });
  });

  it("refuses to download without a session instead of failing in the shell", async () => {
    const install = vi.fn(() => Promise.resolve());

    await expect(applyUpdate(dependencies({ install, token: () => null }), UPDATE)).rejects.toThrow(
      "Sign in",
    );
    expect(install).not.toHaveBeenCalled();
  });
});

describe("shouldCheckOnFocus", () => {
  const now = Date.UTC(2026, 8, 18, 12, 0, 0);

  it("checks again when the last answer has gone stale", () => {
    expect(shouldCheckOnFocus(now - FOCUS_THROTTLE_MS, now)).toBe(true);
    expect(shouldCheckOnFocus(now - FOCUS_THROTTLE_MS - 1, now)).toBe(true);
  });

  it("rides on a recent answer, so working in and out of the window costs nothing", () => {
    expect(shouldCheckOnFocus(now, now)).toBe(false);
    expect(shouldCheckOnFocus(now - 1000, now)).toBe(false);
  });

  it("checks on the first focus of a session, before anything has been asked", () => {
    expect(shouldCheckOnFocus(0, now)).toBe(true);
  });
});

describe("check timings", () => {
  it("are short enough to find a release the same session, and far apart enough to be quiet", () => {
    expect(CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(FOCUS_THROTTLE_MS).toBeLessThan(CHECK_INTERVAL_MS);
  });
});
