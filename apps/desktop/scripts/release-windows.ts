import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Stages the installer from a `desktop:package:windows` run under the name the release uses.
// Tauri names it `Concors_<version>_x64-setup.exe`; releases say `x86_64`, which is what the
// control plane matches on and what `release-manifest.ts` recognises. Nothing is rebuilt here:
// the file is exactly what Tauri made (and signed).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("The Windows installer is built on Windows x64.");

const config = JSON.parse(
  await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { productName: string; version: string };
const built = join(
  root,
  `apps/desktop/src-tauri/target/release/bundle/nsis/${config.productName}_${config.version}_x64-setup.exe`,
);
await access(built).catch(() => {
  throw new Error(`Missing ${built}. Run: VITE_CONCORS_API_URL=<api> pnpm desktop:package:windows`);
});

const output = join(root, "apps/desktop/dist/release");
const name = `Concors-${config.version}-x86_64-setup.exe`;
const staged = join(output, name);
await mkdir(output, { recursive: true });
await copyFile(built, staged);
// Windows has no sha256sum; the line is what `sha256sum -c` reads, like the Linux builds'.
const digest = createHash("sha256")
  .update(await readFile(staged))
  .digest("hex");
await writeFile(`${staged}.sha256`, `${digest}  ${name}\n`);
process.stdout.write(`${staged}\n${digest}\n`);
