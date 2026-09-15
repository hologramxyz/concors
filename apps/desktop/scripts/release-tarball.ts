import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Assembles the distributable Linux tree from an existing `desktop:package:linux --no-bundle` run.
// The layout is deliberately relocatable: Tauri resolves resources as `<exe dir>/../lib/<productName>`
// before falling back to `/usr/lib/<productName>`, so `bin/` + `lib/Concors/` works unpacked in a
// home directory, installed under `/opt`, or restaged by a distro package.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = join(root, "apps/desktop/src-tauri/target/release/concors-desktop");
const daemon = join(root, "apps/desktop/src-tauri/resources/local-daemon/concors-daemon");
const icons = join(root, "apps/desktop/src-tauri/icons");

if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("The Linux release tarball is built on Linux x64.");

const config = JSON.parse(
  await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { productName: string; version: string };
const name = `Concors-${config.version}-x64`;
const output = join(root, "apps/desktop/dist/release");
const stage = join(output, name);

// Fail with the command to run rather than producing a tarball that is missing its runtime.
for (const [path, hint] of [
  [binary, "pnpm desktop:package:linux --no-bundle"],
  [join(daemon, "bin/concors-daemon"), "pnpm desktop:package:linux --no-bundle"],
] as const)
  await readFile(path).catch(() => {
    throw new Error(`Missing ${path}. Run: VITE_CONCORS_API_URL=<api> ${hint}`);
  });

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "bin"), { recursive: true });
await mkdir(join(stage, `lib/${config.productName}`), { recursive: true });
await mkdir(join(stage, "icons"), { recursive: true });

await cp(binary, join(stage, "bin/concors-desktop"), { preserveTimestamps: true });
await cp(daemon, join(stage, `lib/${config.productName}/daemon`), {
  recursive: true,
  dereference: true,
  preserveTimestamps: true,
});
// hicolor-friendly names so packagers can install them without inspecting each file.
for (const [source, size] of [
  ["32x32.png", "32x32"],
  ["128x128.png", "128x128"],
  ["128x128@2x.png", "256x256"],
  ["icon.png", "512x512"],
] as const)
  await cp(join(icons, source), join(stage, `icons/${size}.png`));
await cp(join(root, "LICENSE"), join(stage, "LICENSE"));
await cp(join(daemon, "NODE_LICENSE"), join(stage, "NODE_LICENSE"));

const daemonRelease = JSON.parse(await readFile(join(daemon, "release.json"), "utf8")) as {
  version: string;
  nodeVersion: string;
};
await writeFile(
  join(stage, "release.json"),
  JSON.stringify(
    {
      version: config.version,
      daemonVersion: daemonRelease.version,
      nodeVersion: daemonRelease.nodeVersion,
      platform: "linux",
      arch: "x64",
    },
    null,
    2,
  ) + "\n",
);

const archive = join(output, `${name}.tar.gz`);
await rm(archive, { force: true });
execFileSync("tar", ["-czf", archive, "-C", output, name], { stdio: "inherit" });
const [digest] = execFileSync("sha256sum", [archive], { encoding: "utf8" }).split(/\s+/);
await writeFile(join(output, `${name}.tar.gz.sha256`), `${digest}  ${name}.tar.gz\n`);
process.stdout.write(`${archive}\n${digest}\n`);
