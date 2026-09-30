import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { nextVersion, planRelease, setDaemonVersion } from "./release-plan.ts";

describe("nextVersion", () => {
  it("bumps the patch or the minor number", () => {
    expect(nextVersion("0.6.14", "patch")).toBe("0.6.15");
    expect(nextVersion("0.6.14", "minor")).toBe("0.7.0");
  });

  it("drops a pre-release suffix rather than bumping past it", () => {
    expect(nextVersion("0.7.0-rc.1", "patch")).toBe("0.7.1");
  });

  it("refuses something that is not a version", () => {
    expect(() => nextVersion("latest", "patch")).toThrow("not a version");
  });
});

describe("planRelease", () => {
  const current = { desktop: "0.6.14", daemon: "0.6.14" };

  it("moves only what is being released, so a desktop release never restarts cloud sessions", () => {
    expect(planRelease(current, "desktop", "patch")).toEqual({ desktop: "0.6.15" });
    expect(planRelease(current, "daemon", "patch")).toEqual({ daemon: "0.6.15" });
    expect(planRelease({ desktop: "0.6.14", daemon: "0.6.20" }, "both", "minor")).toEqual({
      desktop: "0.7.0",
      daemon: "0.7.0",
    });
  });
});

describe("setDaemonVersion", () => {
  it("rewrites the package's own version and nothing else", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-plan-"));
    await mkdir(join(root, "packages/daemon"), { recursive: true });
    const path = join(root, "packages/daemon/package.json");
    await writeFile(
      path,
      '{\n  "name": "@concors/daemon",\n  "version": "0.6.14",\n  "dependencies": { "ws": "8.0.0" }\n}\n',
    );
    await setDaemonVersion("0.6.15", root);
    expect(await readFile(path, "utf8")).toBe(
      '{\n  "name": "@concors/daemon",\n  "version": "0.6.15",\n  "dependencies": { "ws": "8.0.0" }\n}\n',
    );
  });
});
