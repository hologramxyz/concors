import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime data is partitioned per signed-in identity. Without this, every account that signs in on
 * a machine shares one workspace database, so switching accounts — or running a development build
 * against one control plane and a packaged build against another — silently mixes projects,
 * terminals and agent history.
 *
 * The key combines the control-plane origin with the user id. The user id alone is not enough:
 * separate control planes are separate databases and may mint the same subject, so development and
 * production could collide. Including the origin makes that structurally impossible.
 *
 * This is a partition key, not a credential. The local gateway binds to loopback and authenticates
 * nothing (see `hosting/gateway.ts`); anything able to reach it already has the access that faking
 * a key would grant. Treat it as a namespace, never as proof of identity.
 */
const KEY_PATTERN = /^[a-f0-9]{16}$/;

export class ProfileError extends Error {}

/** Normalizes to an origin so `https://Api.Example.com/` and `https://api.example.com` agree. */
function normalizeOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ProfileError(`Profile origin is not a URL: ${origin}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new ProfileError(`Profile origin must be http(s): ${origin}`);
  return parsed.origin.toLowerCase();
}

export function profileKey(origin: string, userId: string): string {
  const user = userId.trim();
  if (!user) throw new ProfileError("Profile user id is empty");
  // The separator keeps ("https://a", "bc") distinct from ("https://ab", "c").
  return createHash("sha256")
    .update(`${normalizeOrigin(origin)}\n${user}`)
    .digest("hex")
    .slice(0, 16);
}

/** Base directory holding every profile; also the legacy location of an unpartitioned install. */
export function baseDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors");
}

export function profilesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(baseDataDir(env), "profiles");
}

export interface ProfileIdentity {
  readonly origin: string;
  readonly userId: string;
}

export function identityFromEnv(env: NodeJS.ProcessEnv = process.env): ProfileIdentity | undefined {
  const origin = env["CONCORS_PROFILE_ORIGIN"];
  const userId = env["CONCORS_PROFILE_USER"];
  if (!origin || !userId) return undefined;
  return { origin, userId };
}

export function profileDir(
  identity: ProfileIdentity,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = profileKey(identity.origin, identity.userId);
  // Defence in depth: the key is derived here, but it becomes a path segment.
  if (!KEY_PATTERN.test(key)) throw new ProfileError("Derived profile key is malformed");
  return join(profilesDir(env), key);
}

/**
 * Data directory for this process. Falls back to the unpartitioned base directory when no identity
 * is configured, so managed machines, tests and `--ephemeral` runs behave exactly as before.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const identity = identityFromEnv(env);
  return identity ? profileDir(identity, env) : baseDataDir(env);
}

/**
 * Environment for a child process that is handed an already-resolved data directory.
 *
 * The profile variables must be stripped: leaving them in place makes the child resolve a *second*
 * profile directory beneath the one it was given, so it serves a different database than its parent
 * is waiting on.
 */
export function resolvedDataDirEnv(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, CONCORS_DATA_DIR: directory };
  delete next["CONCORS_PROFILE_ORIGIN"];
  delete next["CONCORS_PROFILE_USER"];
  return next;
}
