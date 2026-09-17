import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DAEMON_VERSION } from "../version.ts";
import { ensureSessionHost, hostBuild, stopSessionHost } from "./session-host.ts";

const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
const launch = {
  executable: process.execPath,
  args: [cli, "session-host", "--log-level", "silent"],
};
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await stopSessionHost(directory).catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "concors-host-build-"));
  directories.push(directory);
  return directory;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("hostBuild", () => {
  it("changes when the daemon's code changes, even at the same version", async () => {
    const directory = await fixture();
    const copy = join(directory, "cli.ts");
    await cp(cli, copy);
    const same = await hostBuild({ ...launch, args: [copy, "session-host"] });
    expect(same).toBe(await hostBuild(launch));

    await writeFile(copy, `${await readFile(cli, "utf8")}\n// rebuilt\n`);
    const rebuilt = await hostBuild({ ...launch, args: [copy, "session-host"] });
    // The version alone would have missed this: it is identical on both sides.
    expect(rebuilt).not.toBe(same);
    expect(rebuilt.startsWith(`${DAEMON_VERSION}:`)).toBe(true);
  });

  it("falls back to the version rather than forcing endless replacements", async () => {
    expect(await hostBuild({ executable: "/missing/daemon", args: [] })).toBe(
      `${DAEMON_VERSION}:unknown`,
    );
  });
});

describe("ensureSessionHost", () => {
  it("keeps the running host when the build is unchanged", async () => {
    const directory = await fixture();
    const first = await ensureSessionHost(directory, launch);
    const second = await ensureSessionHost(directory, launch);
    expect(second.pid).toBe(first.pid);
    expect(second.build).toBe(await hostBuild(launch));
  });

  it("replaces a host left behind by a previous build", async () => {
    const directory = await fixture();
    const previous = await ensureSessionHost(directory, launch, "0.3.0:previousbuild");
    expect(previous.build).toBe("0.3.0:previousbuild");

    const current = await ensureSessionHost(directory, launch);
    expect(current.pid).not.toBe(previous.pid);
    expect(current.build).toBe(await hostBuild(launch));
    await expect.poll(() => alive(previous.pid)).toBe(false);
  });

  it("replaces a host from before builds were recorded", async () => {
    const directory = await fixture();
    const previous = await ensureSessionHost(directory, launch);
    const descriptor = join(directory, "session-host", "host.json");
    const { build: _build, ...withoutBuild } = JSON.parse(await readFile(descriptor, "utf8")) as {
      build?: string;
    };
    await writeFile(descriptor, JSON.stringify(withoutBuild));

    const current = await ensureSessionHost(directory, launch);
    expect(current.pid).not.toBe(previous.pid);
    expect(current.build).toBeDefined();
  });
});
