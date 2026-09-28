import { describe, expect, it } from "vitest";

import { agreedVersion, bumpSources, desktopVersion } from "./release-version.ts";
import { collectArtifacts, describeArtifact } from "./release-manifest.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sources = (
  over: Partial<Record<"packageJson" | "tauriConf" | "pkgbuild" | "cargoToml", string>> = {},
) => ({
  packageJson: JSON.stringify({ name: "@concors/desktop", version: "0.2.0" }),
  tauriConf: JSON.stringify({ productName: "Concors", version: "0.2.0" }),
  pkgbuild: "pkgname=concors-bin\npkgver=0.2.0\npkgrel=1\n",
  cargoToml: '[package]\nname = "concors-desktop"\nversion = "0.2.0"\nedition = "2021"\n',
  ...over,
});

describe("agreedVersion", () => {
  it("returns the version when every file carries it", () => {
    expect(agreedVersion(sources())).toBe("0.2.0");
  });

  it("names the file that drifted, not just that something is wrong", () => {
    expect(() =>
      agreedVersion(sources({ tauriConf: JSON.stringify({ version: "0.1.0" }) })),
    ).toThrow("src-tauri/tauri.conf.json is 0.1.0");
    expect(() => agreedVersion(sources({ pkgbuild: "pkgver=0.1.0\n" }))).toThrow(
      "PKGBUILD pkgver is 0.1.0",
    );
    expect(() => agreedVersion(sources({ cargoToml: '[package]\nversion = "0.1.0"\n' }))).toThrow(
      "Cargo.toml is 0.1.0",
    );
  });

  it("reports every disagreement at once", () => {
    const error = (): string => {
      try {
        agreedVersion(
          sources({ tauriConf: JSON.stringify({ version: "0.1.0" }), pkgbuild: "pkgver=9.9.9\n" }),
        );
      } catch (problem) {
        return (problem as Error).message;
      }
      return "";
    };
    expect(error()).toContain("tauri.conf.json is 0.1.0");
    expect(error()).toContain("PKGBUILD pkgver is 9.9.9");
  });

  it("rejects a package.json without a usable version", () => {
    expect(() => agreedVersion(sources({ packageJson: JSON.stringify({}) }))).toThrow(
      "has no version",
    );
    expect(() =>
      agreedVersion(sources({ packageJson: JSON.stringify({ version: "latest" }) })),
    ).toThrow("has no version");
  });

  it("accepts a pre-release version", () => {
    expect(
      agreedVersion({
        packageJson: JSON.stringify({ version: "0.2.0-rc.1" }),
        tauriConf: JSON.stringify({ version: "0.2.0-rc.1" }),
        pkgbuild: "pkgver=0.2.0-rc.1\n",
        cargoToml: 'version = "0.2.0-rc.1"\n',
      }),
    ).toBe("0.2.0-rc.1");
  });
});

describe("bumpSources", () => {
  const cargo = [
    "[package]",
    'name = "concors-desktop"',
    'version = "0.2.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'tauri = { version = "2", features = [] }',
    'serde = "1"',
    "",
    "[profile.release]",
    'opt-level = "s"',
  ].join("\n");

  const bumped = (version = "0.3.0") =>
    bumpSources(
      sources({ cargoToml: cargo, packageJson: JSON.stringify({ version: "0.2.0" }) }),
      version,
    );

  it("carries the new version into every file", () => {
    expect(agreedVersion(bumped())).toBe("0.3.0");
  });

  it("leaves dependency versions alone", () => {
    const result = bumped().cargoToml;
    expect(result).toContain('tauri = { version = "2", features = [] }');
    expect(result).toContain('serde = "1"');
    expect(result).toContain('version = "0.3.0"');
    expect(result).toContain("[profile.release]");
  });

  it("resets pkgrel, which only climbs when one version is repackaged", () => {
    const result = bumpSources(
      sources({ pkgbuild: "pkgname=concors-bin\npkgver=0.2.0\npkgrel=3\n" }),
      "0.3.0",
    ).pkgbuild;
    expect(result).toContain("pkgver=0.3.0");
    expect(result).toContain("pkgrel=1");
  });

  it("refuses anything that is not a version", () => {
    for (const bad of ["latest", "v0.3.0", "0.3", ""])
      expect(() => bumped(bad)).toThrow("is not a version");
  });

  it("accepts a pre-release version", () => {
    expect(agreedVersion(bumped("0.3.0-rc.1"))).toBe("0.3.0-rc.1");
  });
});

describe("desktopVersion", () => {
  it("agrees across this checkout, which is what the release workflow asserts", async () => {
    await expect(desktopVersion()).resolves.toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("describeArtifact", () => {
  it("recognises each published format by its file name", () => {
    expect(describeArtifact("Concors-0.2.0-x64.tar.gz", "0.2.0")).toEqual({
      format: "tarball",
      platform: "linux",
      arch: "x86_64",
    });
    expect(describeArtifact("concors-bin-0.2.0-1-x86_64.pkg.tar.zst", "0.2.0")).toMatchObject({
      format: "pacman",
    });
    expect(describeArtifact("concors-bin-0.2.0-2-x86_64.pkg.tar.zst", "0.2.0")).toMatchObject({
      format: "pacman",
    });
    expect(describeArtifact("Concors-0.2.0-x86_64.AppImage", "0.2.0")).toMatchObject({
      format: "appimage",
    });
    expect(describeArtifact("Concors-0.2.0-aarch64.dmg", "0.2.0")).toEqual({
      format: "dmg",
      platform: "darwin",
      arch: "aarch64",
    });
    expect(describeArtifact("Concors-0.2.0-x86_64.dmg", "0.2.0")).toMatchObject({
      arch: "x86_64",
    });
    // Tauri's own name for the image, before the release step renames it.
    expect(describeArtifact("Concors_0.2.0_aarch64.dmg", "0.2.0")).toBeNull();
  });

  it("ignores checksums, signatures and builds of another version", () => {
    expect(describeArtifact("Concors-0.2.0-x64.tar.gz.sha256", "0.2.0")).toBeNull();
    expect(describeArtifact("Concors-0.2.0-x64.tar.gz.sig", "0.2.0")).toBeNull();
    expect(describeArtifact("release.json", "0.2.0")).toBeNull();
    expect(describeArtifact("Concors-0.1.0-x64.tar.gz", "0.2.0")).toBeNull();
  });
});

describe("collectArtifacts", () => {
  it("digests each artifact and leaves everything else out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concors-release-"));
    await writeFile(join(directory, "Concors-0.2.0-x64.tar.gz"), "tree");
    await writeFile(join(directory, "Concors-0.2.0-x64.tar.gz.sha256"), "digest  file");
    await writeFile(join(directory, "concors-bin-0.2.0-1-x86_64.pkg.tar.zst"), "package");

    const artifacts = await collectArtifacts(directory, "0.2.0");

    expect(artifacts.map((artifact) => artifact.format)).toEqual(["tarball", "pacman"]);
    expect(artifacts[0]).toEqual({
      name: "Concors-0.2.0-x64.tar.gz",
      format: "tarball",
      platform: "linux",
      arch: "x86_64",
      size: 4,
      sha256: "dc9c5edb8b2d479e697b4b0b8ab874f32b325138598ce9e7b759eb8292110622",
    });
    expect(artifacts[1]).toMatchObject({
      name: "concors-bin-0.2.0-1-x86_64.pkg.tar.zst",
      size: 7,
      sha256: "bc4a71180870f7945155fbb02f4b0a2e3faa2a62d6d31b7039013055ed19869a",
    });
  });

  it("carries the detached signature when the build was signed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concors-release-"));
    await writeFile(join(directory, "Concors-0.2.0-x64.tar.gz"), "tree");
    // `tauri signer sign` writes the base64 blob with a trailing newline.
    await writeFile(join(directory, "Concors-0.2.0-x64.tar.gz.sig"), "dW50cnVzdGVk\n");
    await writeFile(join(directory, "concors-bin-0.2.0-1-x86_64.pkg.tar.zst"), "package");

    const artifacts = await collectArtifacts(directory, "0.2.0");

    expect(artifacts[0]?.signature).toBe("dW50cnVzdGVk");
    // An unsigned build carries no empty string to be mistaken for a signature.
    expect(artifacts[1]).not.toHaveProperty("signature");
  });
});
