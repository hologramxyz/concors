import { execFileSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Stages the AppImage from a `desktop:package:linux --bundles appimage` run under the name the
// release uses. Tauri names it `Concors_<version>_amd64.AppImage`, Debian's word for the
// architecture; releases say `x86_64`, which is what the control plane matches on and what
// `release-manifest.ts` recognises. Nothing is rebuilt here: the file is exactly what Tauri made.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("The Linux AppImage is built on Linux x64.");

const config = JSON.parse(
  await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { productName: string; version: string };
const built = join(
  root,
  `apps/desktop/src-tauri/target/release/bundle/appimage/${config.productName}_${config.version}_amd64.AppImage`,
);
await access(built).catch(() => {
  throw new Error(
    `Missing ${built}. Run: VITE_CONCORS_API_URL=<api> pnpm desktop:package:linux --bundles appimage`,
  );
});

const output = join(root, "apps/desktop/dist/release");
const name = `Concors-${config.version}-x86_64.AppImage`;
const staged = join(output, name);
await mkdir(output, { recursive: true });
await copyFile(built, staged);
// Downloads lose the mode anyway; this is for running it straight from the release directory.
await chmod(staged, 0o755);
const [digest] = execFileSync("sha256sum", [staged], { encoding: "utf8" }).split(/\s+/);
await writeFile(`${staged}.sha256`, `${digest}  ${name}\n`);
process.stdout.write(`${staged}\n${digest}\n`);
