import { readFile, writeFile } from "node:fs/promises";
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

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Every file rewritten to carry `version`. Pure, so the rewrite is testable without a checkout. */
export function bumpSources(sources: VersionSources, version: string): VersionSources {
  if (!VERSION_PATTERN.test(version))
    throw new Error(`"${version}" is not a version like 0.3.0 or 0.3.0-rc.1`);
  // Anchored replacements, one each: the value being replaced is the file's own version, never a
  // dependency's. In Cargo.toml only `[package]` is touched, since dependency versions are inline.
  // Cargo.toml opens with `[package]`; everything from the next section header on is left alone,
  // so a dependency pinned to its own version is never rewritten.
  const nextSection = sources.cargoToml.search(/^\[(?!package\])/m);
  const packageSection =
    nextSection === -1 ? sources.cargoToml : sources.cargoToml.slice(0, nextSection);
  const otherSections = nextSection === -1 ? "" : sources.cargoToml.slice(nextSection);
  return {
    packageJson: sources.packageJson.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`),
    tauriConf: sources.tauriConf.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`),
    // A new version starts at pkgrel 1; the number only climbs when a release is repackaged.
    pkgbuild: sources.pkgbuild
      .replace(/^pkgver=.*$/m, `pkgver=${version}`)
      .replace(/^pkgrel=.*$/m, "pkgrel=1"),
    cargoToml:
      packageSection.replace(/^version = ".*"$/m, `version = "${version}"`) + otherSections,
  };
}

/** Writes the bumped files back and returns the version, having checked they now agree. */
export async function setDesktopVersion(version: string, root = repoRoot): Promise<string> {
  const paths = {
    packageJson: join(root, "apps/desktop/package.json"),
    tauriConf: join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    pkgbuild: join(root, "packaging/linux/PKGBUILD"),
    cargoToml: join(root, "apps/desktop/src-tauri/Cargo.toml"),
  } as const;
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")] as const),
  );
  const bumped = bumpSources(Object.fromEntries(entries) as unknown as VersionSources, version);
  await Promise.all(
    Object.entries(paths).map(([key, path]) =>
      writeFile(path, bumped[key as keyof VersionSources]),
    ),
  );
  // Reads the files back, so a rewrite that silently missed one fails here and not in CI.
  return desktopVersion(root);
}

// `node apps/desktop/scripts/release-version.ts` prints the version and fails loudly when the files
// have drifted apart; `--set <version>` rewrites all four. The release workflow runs the check
// before building anything.
// Compared as paths: a `file://` URL built by hand matches neither Windows paths nor spaces.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const set = process.argv.indexOf("--set");
  if (set === -1) {
    process.stdout.write(`${await desktopVersion()}\n`);
  } else {
    const wanted = process.argv[set + 1];
    if (!wanted) throw new Error("--set needs a version, e.g. --set 0.3.0");
    const previous = await desktopVersion().catch(() => "unknown");
    const version = await setDesktopVersion(wanted);
    // Releases bump through the Release workflow; this is for trying a version locally.
    process.stdout.write(
      `${previous} -> ${version}\n\n` +
        `Cargo.lock still records the old version; refresh it with:\n` +
        `  cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --format-version 1 >/dev/null\n\n` +
        `To publish a release, run the Release workflow instead (see Releasing in AGENTS.md).\n`,
    );
  }
}
