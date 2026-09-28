import { execFileSync } from "node:child_process";
import { mkdir, open, readdir, rm } from "node:fs/promises";
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
const daemon = join(resources, "concors-daemon");
const identity = process.env["APPLE_SIGNING_IDENTITY"];
if (identity) await signRuntime(daemon, identity);
// Prove that the relocated runtime includes Node and the native terminal module before bundling it.
// After signing, so a missing entitlement fails here rather than on someone else's Mac.
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

/**
 * Signs every Mach-O in the daemon runtime with the identity Tauri signs the app with. Notarization
 * rejects a bundle holding any executable code that is not signed by a Developer ID under the
 * hardened runtime, and nodejs.org's own signature carries `get-task-allow`, which it also refuses,
 * so Node is re-signed rather than left alone. `-` signs ad hoc, which exercises the entitlements
 * locally without a certificate.
 */
async function signRuntime(directory: string, identity: string): Promise<void> {
  const entitlements = join(root, "apps/desktop/src-tauri/macos");
  const node = join(directory, "bin/node");
  const binaries = (await machOFiles(directory)).filter((path) => path !== node);
  // Node last, though nothing here nests, so the order only keeps the log readable.
  for (const [path, plist] of [...binaries.map((path) => [path, null] as const), [node, "node"]]) {
    execFileSync(
      "codesign",
      [
        "--force",
        "--sign",
        identity,
        "--options",
        "runtime",
        // Apple's timestamp server refuses ad hoc signatures, and notarization requires one.
        identity === "-" ? "--timestamp=none" : "--timestamp",
        ...(plist ? ["--entitlements", join(entitlements, `${plist}.entitlements`)] : []),
        path,
      ],
      { stdio: "inherit" },
    );
  }
}

/** Mach-O files, recognised by their magic rather than by name: addons and dylibs alike. */
async function machOFiles(directory: string): Promise<string[]> {
  const magics = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
  const found: string[] = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const handle = await open(path, "r");
    try {
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      if (bytesRead === 4 && magics.has(buffer.readUInt32BE(0))) found.push(path);
    } finally {
      await handle.close();
    }
  }
  return found;
}
