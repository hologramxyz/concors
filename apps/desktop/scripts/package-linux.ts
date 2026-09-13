import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("The first local desktop package targets Linux x64. Build it on Linux x64.");
if (!process.env["VITE_CONCORS_API_URL"])
  throw new Error("Set VITE_CONCORS_API_URL to the control-plane URL for this desktop build.");

const resources = join(root, "apps/desktop/src-tauri/resources/local-daemon");
execFileSync("pnpm", ["daemon:package"], { cwd: root, stdio: "inherit" });
await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
execFileSync(
  "tar",
  [
    "-xzf",
    join(root, "packages/daemon/dist/release/concors-daemon-linux-x64.tar.gz"),
    "-C",
    resources,
  ],
  { stdio: "inherit" },
);
// Prove that the relocated runtime includes Node and the native terminal module before bundling it.
const daemon = join(resources, "concors-daemon");
execFileSync(
  join(daemon, "bin/node"),
  [join(root, "packages/daemon/scripts/smoke-bundle.ts"), "--release", daemon],
  { cwd: root, stdio: "inherit" },
);
execFileSync(
  "pnpm",
  [
    "--filter",
    "@concors/desktop",
    "tauri",
    "build",
    "--config",
    "src-tauri/tauri.local-linux.conf.json",
    ...process.argv.slice(2).filter((arg) => arg !== "--"),
  ],
  { cwd: root, stdio: "inherit" },
);
