import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the official runtime and its published SHA-256, independent of the build host's libc.
// Every platform ships the same Node so a bug is reproduced identically wherever it is reported;
// the checksums come from https://nodejs.org/dist/v<version>/SHASUMS256.txt.
const NODE_VERSION = "24.20.0";

/**
 * One entry per runtime we publish. `tarFlag` differs because nodejs.org ships Linux as .tar.xz
 * and macOS as .tar.gz, and `tar -xJf` on a gzip archive fails rather than falling back.
 */
const TARGETS = {
  "linux-x64": {
    nodeArchive: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
    nodeSha256: "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2",
    tarFlag: "-xJf",
  },
  "darwin-arm64": {
    nodeArchive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeSha256: "40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8",
    tarFlag: "-xzf",
  },
  "darwin-x64": {
    nodeArchive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    nodeSha256: "9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4",
    tarFlag: "-xzf",
  },
} as const;

type TargetKey = keyof typeof TARGETS;

/**
 * Accepts a full `platform-arch` key, a bare platform (the host's architecture is filled in, so
 * one `package:macos` script serves both Apple Silicon and Intel), or nothing at all for the host.
 */
export function resolveTarget(
  requested: string | undefined,
  host: { platform: string; arch: string },
): TargetKey {
  const hostKey = `${host.platform}-${host.arch}`;
  const target = !requested
    ? hostKey
    : requested.includes("-")
      ? requested
      : `${requested}-${host.arch}`;
  if (!(target in TARGETS))
    throw new Error(
      `No packaged runtime for ${target}. Supported: ${Object.keys(TARGETS).join(", ")}.`,
    );
  // The bundled native terminal module is the host's prebuild, so this never cross-compiles.
  if (target !== hostKey)
    throw new Error(`Build the ${target} release on ${target} (or in a ${target} container).`);
  return target as TargetKey;
}

async function main(): Promise<void> {
  const target = resolveTarget(process.argv[2], process);
  const { nodeArchive, nodeSha256, tarFlag } = TARGETS[target];
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = join(root, "dist", "release");

  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(output, ".package-"));
  try {
    const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeArchive}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== nodeSha256)
      throw new Error("Node archive SHA-256 does not match the pinned release");
    await writeFile(join(temporary, nodeArchive), bytes);
    execFileSync("tar", [tarFlag, join(temporary, nodeArchive), "-C", temporary]);

    const directory = join(temporary, "concors-daemon");
    await mkdir(join(directory, "bin"), { recursive: true });
    await mkdir(join(directory, "lib"));
    for (const file of ["cli.js", "package.json", "node_modules", "THIRD_PARTY_NOTICES.txt"])
      await cp(join(root, "dist", file), join(directory, "lib", file), {
        recursive: true,
        dereference: true,
      });
    const nodeDirectory = join(temporary, nodeArchive.replace(/\.tar\.(gz|xz)$/, ""));
    await cp(join(nodeDirectory, "bin", "node"), join(directory, "bin", "node"));
    await cp(join(nodeDirectory, "LICENSE"), join(directory, "NODE_LICENSE"));
    await cp(join(root, "..", "..", "LICENSE"), join(directory, "LICENSE"));
    await writeFile(
      join(directory, "bin", "concors-daemon"),
      `#!/bin/sh
set -eu
DAEMON_BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DAEMON_BIN_DIR/node" "$DAEMON_BIN_DIR/../lib/cli.js" "$@"
`,
    );
    await chmod(join(directory, "bin", "concors-daemon"), 0o755);
    await chmod(join(directory, "bin", "node"), 0o755);
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    const [platform, arch] = target.split("-");
    await writeFile(
      join(directory, "release.json"),
      JSON.stringify(
        { version: manifest.version, nodeVersion: NODE_VERSION, platform, arch },
        null,
        2,
      ) + "\n",
    );
    const archive = join(output, `concors-daemon-${target}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", temporary, "concors-daemon"], {
      // Apple's tar otherwise stores resource forks, which extract as stray ._ files elsewhere.
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    process.stdout.write(`${archive}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

// Importing this module for `resolveTarget` must not download or package anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
