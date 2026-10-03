import { execFileSync, execSync } from "node:child_process";
import { mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasAuthenticodeSignature,
  windowsSigning,
  type WindowsSigning,
} from "./windows-signing.ts";

// The Windows counterpart of package-linux.ts and package-macos.ts: packages the daemon runtime,
// proves it runs where it lies, then builds the NSIS installer around it. With the Artifact
// Signing credentials in the environment (see windows-signing.ts) every executable we ship is
// Authenticode-signed on the way; without them the build is unsigned, which is fine locally and
// which the release workflow refuses.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("The Windows desktop package targets Windows x64. Build it on Windows x64.");
if (!process.env["VITE_CONCORS_API_URL"])
  throw new Error("Set VITE_CONCORS_API_URL to the control-plane URL for this desktop build.");

const signing = windowsSigning(process.env);
const resources = join(root, "apps/desktop/src-tauri/resources/local-daemon");
pnpm(["daemon:package:windows"]);
await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
execFileSync(
  join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe"),
  [
    "-xzf",
    join(root, "packages/daemon/dist/release/concors-daemon-win32-x64.tar.gz"),
    "-C",
    resources,
  ],
  { stdio: "inherit" },
);
const daemon = join(resources, "concors-daemon");
if (signing) await signRuntime(daemon, signing);
// Prove that the relocated runtime includes Node and the native terminal module before bundling it.
// After signing, so a signature that breaks a module fails here rather than on someone's PC.
execFileSync(
  join(daemon, "bin", "node.exe"),
  [join(root, "packages/daemon/scripts/smoke-bundle.ts"), "--release", daemon],
  { cwd: root, stdio: "inherit" },
);

const configs = ["src-tauri/tauri.local-windows.conf.json"];
if (signing) {
  // Tauri signs the app executable before the installer embeds it, then the installer and its
  // uninstaller, so signing cannot happen after the build. Through a file rather than an inline
  // JSON argument, which cmd.exe (how pnpm is started here) would split at its spaces and quotes.
  const generated = join(root, "apps/desktop/src-tauri/target/windows-signing.conf.json");
  await mkdir(dirname(generated), { recursive: true });
  await writeFile(
    generated,
    JSON.stringify({
      bundle: { windows: { signCommand: { cmd: signing.tool, args: [...signing.args, "%1"] } } },
    }),
  );
  configs.push(generated);
} else {
  process.stdout.write(
    "Artifact Signing credentials are not set: building an unsigned installer.\n",
  );
}
pnpm([
  "--filter",
  "@concors/desktop",
  "tauri",
  "build",
  ...configs.flatMap((config) => ["--config", config]),
  ...process.argv.slice(2).filter((arg) => arg !== "--"),
]);

/**
 * pnpm is a .cmd on Windows, which Node will only start through a shell. cmd.exe receives one
 * command line, so an argument holding a space (a checkout under "C:\Users\Some One") is quoted.
 */
function pnpm(args: string[]): void {
  const quoted = args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg));
  execSync(["pnpm", ...quoted].join(" "), { cwd: root, stdio: "inherit" });
}

/**
 * Signs the runtime's own executables and libraries: the terminal module, ConPTY and the speech
 * engine. Windows does not ask for these to be signed, but Defender and SmartScreen weigh
 * unsigned code a signed app loads, and Tauri signs only what it builds. Files that arrive signed
 * (node.exe by the Node.js project, ConPTY by Microsoft) keep their publisher's signature.
 */
async function signRuntime(directory: string, signing: WindowsSigning): Promise<void> {
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(exe|dll|node)$/i.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const handle = await open(path, "r");
    const { buffer, bytesRead } = await handle
      .read(Buffer.alloc(4096), 0, 4096, 0)
      .finally(() => handle.close());
    if (hasAuthenticodeSignature(buffer.subarray(0, bytesRead)) !== false) continue;
    execFileSync(signing.tool, [...signing.args, path], { stdio: "inherit" });
  }
}
