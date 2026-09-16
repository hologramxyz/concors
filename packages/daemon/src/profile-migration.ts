import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { stopSessionHost } from "./hosting/session-host.ts";
import { baseDataDir, profilesDir } from "./profile.ts";

/** Everything an unpartitioned install kept directly in the base directory. */
const LEGACY_ENTRIES = [
  "workspace.sqlite",
  "workspace.sqlite-wal",
  "workspace.sqlite-shm",
  "session-host.log",
  "pi-sessions",
  "providers",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    // Only a cross-device base directory should need a copy.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

/**
 * Moves an existing unpartitioned installation into the first profile that signs in, so upgrading
 * keeps projects, terminals and agent history instead of presenting an empty machine.
 *
 * Only ever runs once: the presence of any profile means partitioning is already in effect, and a
 * later account must start empty rather than inherit the first account's data.
 *
 * Adoption stops the legacy session host first, because its database moves out from under it. That
 * ends running terminals — the same trade `desktop:reload` already makes — while every persisted
 * record survives.
 */
export async function adoptLegacyData(
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const base = baseDataDir(env);
  if (await exists(target)) return false;
  const profiles = profilesDir(env);
  // A populated profiles directory means some account already owns this machine's partitioning.
  if ((await readdir(profiles).catch(() => [])).length > 0) return false;
  if (!(await exists(join(base, "workspace.sqlite")))) return false;

  await stopSessionHost(base);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const entry of LEGACY_ENTRIES) {
    const from = join(base, entry);
    if (await exists(from)) await move(from, join(target, entry));
  }
  // The stopped host removes its own lock directory; clear a crashed leftover so it cannot be
  // mistaken for a live owner of the now-empty base directory.
  await rm(join(base, "session-host"), { recursive: true, force: true });
  return true;
}
