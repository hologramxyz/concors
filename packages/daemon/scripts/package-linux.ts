import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the official runtime and its published SHA-256, independent of the build host's libc.
const NODE_VERSION = "24.20.0";
const NODE_SHA256 = "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "release");

if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Build the Linux x64 release on Linux x64 (or in a Linux x64 container).");

await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(output, ".package-"));
try {
  const nodeArchive = `node-v${NODE_VERSION}-linux-x64.tar.xz`;
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeArchive}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== NODE_SHA256)
    throw new Error("Node archive SHA-256 does not match the pinned release");
  await writeFile(join(temporary, nodeArchive), bytes);
  execFileSync("tar", ["-xJf", join(temporary, nodeArchive), "-C", temporary]);

  const directory = join(temporary, "concors-daemon");
  await mkdir(join(directory, "bin"), { recursive: true });
  await mkdir(join(directory, "lib"));
  for (const file of ["cli.js", "package.json", "node_modules", "THIRD_PARTY_NOTICES.txt"])
    await cp(join(root, "dist", file), join(directory, "lib", file), {
      recursive: true,
      dereference: true,
    });
  const nodeDirectory = join(temporary, `node-v${NODE_VERSION}-linux-x64`);
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
  await writeFile(
    join(directory, "release.json"),
    JSON.stringify(
      {
        version: manifest.version,
        nodeVersion: NODE_VERSION,
        platform: "linux",
        arch: "x64",
      },
      null,
      2,
    ) + "\n",
  );
  const archive = join(output, "concors-daemon-linux-x64.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", temporary, "concors-daemon"]);
  process.stdout.write(`${archive}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
