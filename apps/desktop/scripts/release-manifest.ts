import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { desktopVersion, repoRoot } from "./release-version.ts";

// Writes the `release.json` published alongside the builds. The control plane reads only this
// file to answer "is there an update, and where is it" (concors-server: modules/releases), so it
// has to describe every artifact of the release: how it is installed, what it runs on, and the
// digest the app checks after downloading. The binaries themselves are never read by the API.
//
// Formats are recognised from the file name, which is what the build scripts and PKGBUILD produce.
// An unrecognised file in the release directory is ignored rather than guessed at.

export type DesktopFormat = "tarball" | "pacman" | "appimage";

export interface ArtifactKind {
  format: DesktopFormat;
  /** `linux`, `darwin` or `windows`. */
  platform: string;
  arch: string;
}

export interface ReleaseArtifact extends ArtifactKind {
  name: string;
  size: number;
  sha256: string;
  /**
   * The detached signature next to the build, when the release was signed. The digest alone is
   * enough for the badge, which fetches both from the control plane; a signature is what proves
   * the build came from us rather than from whoever served it, and `tauri-plugin-updater` will
   * not install an update without one.
   */
  signature?: string;
}

export interface ReleaseManifest {
  version: string;
  publishedAt: string;
  notes: string;
  artifacts: ReleaseArtifact[];
}

/** What a released file is, or `null` when it is not one of ours (checksums, signatures). */
export function describeArtifact(name: string, version: string): ArtifactKind | null {
  if (name === `Concors-${version}-x64.tar.gz`)
    return { format: "tarball", platform: "linux", arch: "x86_64" };
  if (new RegExp(`^concors-bin-${escape(version)}-\\d+-x86_64\\.pkg\\.tar\\.zst$`).test(name))
    return { format: "pacman", platform: "linux", arch: "x86_64" };
  if (name === `Concors-${version}-x86_64.AppImage`)
    return { format: "appimage", platform: "linux", arch: "x86_64" };
  return null;
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every artifact in `directory`, in a stable order so two runs produce the same manifest. */
export async function collectArtifacts(
  directory: string,
  version: string,
): Promise<ReleaseArtifact[]> {
  const entries = await readdir(directory);
  const artifacts: ReleaseArtifact[] = [];
  for (const name of entries.sort()) {
    const kind = describeArtifact(name, version);
    if (!kind) continue;
    const path = join(directory, name);
    const [contents, info, signature] = await Promise.all([
      readFile(path),
      stat(path),
      // `tauri signer sign` writes `<artifact>.sig`; its absence means this release is unsigned.
      readFile(`${path}.sig`, "utf8")
        .then((text) => text.trim())
        .catch(() => null),
    ]);
    artifacts.push({
      name,
      ...kind,
      size: info.size,
      sha256: createHash("sha256").update(contents).digest("hex"),
      ...(signature ? { signature } : {}),
    });
  }
  return artifacts;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  const version = await desktopVersion();
  const directory = option("--directory") ?? join(repoRoot, "apps/desktop/dist/release");
  const notesFile = option("--notes-file");
  const notes =
    option("--notes") ??
    (notesFile ? (await readFile(notesFile, "utf8")).trim() : `Concors ${version}.`);

  const artifacts = await collectArtifacts(directory, version);
  if (artifacts.length === 0)
    throw new Error(`No Concors ${version} artifacts in ${directory}; build the release first.`);

  const manifest: ReleaseManifest = {
    version,
    publishedAt: new Date().toISOString(),
    notes,
    artifacts,
  };
  const path = join(directory, "release.json");
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const unsigned = artifacts.filter((artifact) => !artifact.signature);
  if (unsigned.length > 0)
    process.stdout.write(`Unsigned: ${unsigned.map((artifact) => artifact.name).join(", ")}\n`);
  process.stdout.write(
    `${path}\n${artifacts
      .map(
        (a) =>
          `  ${a.format.padEnd(8)} ${a.name} (${a.size} bytes${a.signature ? ", signed" : ""})`,
      )
      .join("\n")}\n`,
  );
}
