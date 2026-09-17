import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The app version lives in `apps/desktop/package.json`, and three other files must agree with it:
// `tauri.conf.json` (what the built binary reports), the Arch `PKGBUILD` (what pacman records) and
// the native crate's `Cargo.toml`. `src/version.ts` reads package.json directly, so it follows on
// its own.
//
// The crate version is inert today — tauri.conf.json carries an explicit version, which wins — but
// it is the number a Rust panic or `cargo` output would show, and a version that only some files
// moved is exactly what this check exists to catch.
//
// They are separate files because each tool insists on its own; nothing but a check keeps them
// together. A release whose pieces disagree is worse than a failed build: the app would ask the
// API for updates to a version it is not, and never stop offering the one it already has.

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface VersionSources {
  /** `apps/desktop/package.json` — the source of truth. */
  packageJson: string;
  tauriConf: string;
  pkgbuild: string;
  cargoToml: string;
}

/** The agreed version, or an error naming every file that disagrees. */
export function agreedVersion(sources: VersionSources): string {
  const version = (JSON.parse(sources.packageJson) as { version?: unknown }).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`apps/desktop/package.json has no version: ${JSON.stringify(version)}`);

  const tauri = (JSON.parse(sources.tauriConf) as { version?: unknown }).version;
  const pkgver = /^pkgver=(.+)$/m.exec(sources.pkgbuild)?.[1]?.trim();
  // The first `version = "..."` in Cargo.toml is the package's own, before any dependency table.
  const crate = /^version = "(.+)"$/m.exec(sources.cargoToml)?.[1];
  const disagree = [
    tauri === version ? null : `src-tauri/tauri.conf.json is ${String(tauri)}`,
    pkgver === version ? null : `packaging/linux/PKGBUILD pkgver is ${pkgver ?? "missing"}`,
    crate === version ? null : `src-tauri/Cargo.toml is ${crate ?? "missing"}`,
  ].filter((problem): problem is string => problem !== null);

  if (disagree.length > 0)
    throw new Error(
      `Desktop version ${version} (apps/desktop/package.json) does not match: ${disagree.join("; ")}`,
    );
  return version;
}

/** Reads the four files from a checkout and returns the version they agree on. */
export async function desktopVersion(root = repoRoot): Promise<string> {
  const [packageJson, tauriConf, pkgbuild, cargoToml] = await Promise.all([
    readFile(join(root, "apps/desktop/package.json"), "utf8"),
    readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
    readFile(join(root, "packaging/linux/PKGBUILD"), "utf8"),
    readFile(join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
  ]);
  return agreedVersion({ packageJson, tauriConf, pkgbuild, cargoToml });
}

// `node apps/desktop/scripts/release-version.ts` prints the version, and fails loudly when the
// files have drifted apart. The release workflow runs it before building anything.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`)
  process.stdout.write(`${await desktopVersion()}\n`);
