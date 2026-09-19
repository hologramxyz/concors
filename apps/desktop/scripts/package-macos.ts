import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The macOS counterpart of package-linux.ts. Unlike Linux there is no usable "bare executable plus
// an adjacent daemon/ directory" mode: the runtime is resolved through the resource directory,
// which only exists as Contents/Resources inside a bundle, so this always builds the .app.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (process.platform !== "darwin") throw new Error("Build the macOS desktop package on macOS.");
if (!process.env["VITE_CONCORS_API_URL"])
  throw new Error("Set VITE_CONCORS_API_URL to the control-plane URL for this desktop build.");

const target = `darwin-${process.arch}`;
const resources = join(root, "apps/desktop/src-tauri/resources/local-daemon");
execFileSync("pnpm", ["daemon:package:macos"], { cwd: root, stdio: "inherit" });
await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
execFileSync(
  "tar",
  [
    "-xzf",
    join(root, `packages/daemon/dist/release/concors-daemon-${target}.tar.gz`),
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
    "src-tauri/tauri.local-macos.conf.json",
    ...process.argv.slice(2).filter((arg) => arg !== "--"),
  ],
  { cwd: root, stdio: "inherit" },
);
