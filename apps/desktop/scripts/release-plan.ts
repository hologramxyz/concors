import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION_PATTERN, desktopVersion, repoRoot, setDesktopVersion } from "./release-version.ts";

// Decides the versions a release will carry and writes them into the repository. The Release
// workflow runs it twice: once with `--dry-run` to name the versions before any test runs, and
// once for real to make the commit it tags. Nobody bumps a version by hand any more.
//
// The desktop app and the daemon keep separate versions on purpose. A daemon version change makes
// every cloud machine restart its session host, ending the terminals and agents running there, so
// a desktop-only release must not move it.

export type Component = "desktop" | "daemon" | "both";
export type Bump = "patch" | "minor";

/** `0.6.14` → `0.6.15` (patch) or `0.7.0` (minor). A pre-release suffix is dropped, not bumped. */
export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match || !VERSION_PATTERN.test(current))
    throw new Error(`"${current}" is not a version like 0.6.14`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

export interface Plan {
  desktop?: string;
  daemon?: string;
}

/** The versions a release of `component` moves to from the current ones. Pure, for testing. */
export function planRelease(
  current: { desktop: string; daemon: string },
  component: Component,
  bump: Bump,
): Plan {
  return {
    ...(component === "daemon" ? {} : { desktop: nextVersion(current.desktop, bump) }),
    ...(component === "desktop" ? {} : { daemon: nextVersion(current.daemon, bump) }),
  };
}

const daemonPackage = (root: string) => join(root, "packages/daemon/package.json");

export async function daemonVersion(root = repoRoot): Promise<string> {
  const { version } = JSON.parse(await readFile(daemonPackage(root), "utf8")) as {
    version?: unknown;
  };
  if (typeof version !== "string") throw new Error("packages/daemon/package.json has no version");
  return version;
}

/** Rewrites only the package's own version, leaving the file's formatting as it was. */
export async function setDaemonVersion(version: string, root = repoRoot): Promise<string> {
  const path = daemonPackage(root);
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
  const written = await daemonVersion(root);
  if (written !== version)
    throw new Error(`packages/daemon/package.json is ${written}, not ${version}`);
  return written;
}

// `node apps/desktop/scripts/release-plan.ts --component desktop --bump patch [--dry-run]` prints
// `desktop=<version>` and/or `daemon=<version>`, the lines GitHub Actions reads as step outputs.
// Compared as paths: a `file://` URL built by hand matches neither Windows paths nor spaces.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const component = option("--component");
  const bump = option("--bump");
  if (component !== "desktop" && component !== "daemon" && component !== "both")
    throw new Error("--component must be desktop, daemon or both");
  if (bump !== "patch" && bump !== "minor") throw new Error("--bump must be patch or minor");

  const plan = planRelease(
    { desktop: await desktopVersion(), daemon: await daemonVersion() },
    component,
    bump,
  );
  if (!args.includes("--dry-run")) {
    if (plan.desktop) await setDesktopVersion(plan.desktop);
    if (plan.daemon) await setDaemonVersion(plan.daemon);
  }
  for (const [name, version] of Object.entries(plan)) process.stdout.write(`${name}=${version}\n`);
}
