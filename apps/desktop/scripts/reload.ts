import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  git,
  localProcesses,
  previewProcesses,
  requireCleanMain,
  stopProcesses,
  updateMain,
} from "./reload-support.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = fileURLToPath(import.meta.url);
const stage = process.argv[2];
const print = (message: string) => process.stdout.write(message + "\n");

async function main() {
  if (stage === "--help") {
    print(
      "pnpm desktop:reload — update clean main, rebuild and restart the Linux desktop and local daemon.",
    );
    print(
      "Local terminals and agents stop. Saved data and login are preserved. Nothing is pushed.",
    );
    print(
      "Optional first-run overrides: VITE_CONCORS_API_URL, CONCORS_DATA_DIR, CARGO_TARGET_DIR.",
    );
    return;
  }
  if (process.env["TERM_PROGRAM"] === "concors")
    throw new Error(
      "Run desktop:reload from an external terminal, not a Concors terminal: reload restarts the local session host.",
    );
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("desktop:reload currently supports Linux x86_64.");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Use Node.js 24 or newer, then rerun pnpm desktop:reload.");
  if (!process.env["DISPLAY"] && !process.env["WAYLAND_DISPLAY"])
    throw new Error("Run desktop:reload from a terminal in your local graphical desktop session.");
  if (process.env["CARGO_BUILD_TARGET"])
    throw new Error("Unset CARGO_BUILD_TARGET: desktop:reload builds for this Linux computer.");
  requireCleanMain(root);

  if (!stage) {
    const lock = resolve(root, git(root, "rev-parse", "--git-path", "desktop-reload.lock"));
    execFileSync("flock", ["-n", "-E", "75", lock, process.execPath, script, "--update"], {
      stdio: "inherit",
    });
    return;
  }
  if (stage === "--update") {
    updateMain(root);
    // Read the updated script after pulling, rather than building with the old script in memory.
    execFileSync(process.execPath, [script, "--build"], { cwd: root, stdio: "inherit" });
    return;
  }
  if (stage !== "--build") throw new Error("Unknown option. Use pnpm desktop:reload --help.");

  const run = (command: string, args: string[], env = process.env) =>
    execFileSync(command, args, { cwd: root, env, stdio: "inherit" });
  run("pnpm", ["install", "--frozen-lockfile"]);
  const { loadEnv } = await import("vite");
  const statePath = resolve(root, git(root, "rev-parse", "--git-path", "desktop-preview.json"));
  const saved = JSON.parse(
    await readFile(statePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    }),
  ) as { apiUrl?: string; dataDirectory?: string; targetDirectory?: string };
  const configured = loadEnv("production", join(root, "apps/desktop"), "");
  const apiUrl =
    process.env["VITE_CONCORS_API_URL"] ??
    configured["VITE_CONCORS_API_URL"] ??
    saved.apiUrl ??
    "https://concors-server-dev.up.railway.app";
  const url = new URL(apiUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("VITE_CONCORS_API_URL must be an HTTP(S) URL without embedded credentials.");
  const defaultTarget = join(root, "apps/desktop/src-tauri/target");
  const targetDirectory = resolve(
    root,
    process.env["CARGO_TARGET_DIR"] ?? saved.targetDirectory ?? defaultTarget,
  );
  const targets = [
    ...new Set([
      defaultTarget,
      targetDirectory,
      ...(saved.targetDirectory ? [saved.targetDirectory] : []),
    ]),
  ];
  // Refuse to interfere with an unrelated installed app before shutting anything down.
  const existing = previewProcesses(await localProcesses(), targets);
  const runningDirectories = new Set(
    existing.apps.map((app) => app.dataDirectory ?? join(homedir(), ".concors")),
  );
  if (runningDirectories.size > 1)
    throw new Error(
      "Multiple Concors data directories are open. Close the extra app before reloading.",
    );
  const dataDirectory = resolve(
    process.env["CONCORS_DATA_DIR"] ??
      saved.dataDirectory ??
      existing.apps[0]?.dataDirectory ??
      join(homedir(), ".concors"),
  );
  if (
    existing.apps.length &&
    existing.apps.some(
      (app) => resolve(app.dataDirectory ?? join(homedir(), ".concors")) !== dataDirectory,
    )
  )
    throw new Error(
      "The running app uses a different data directory. Close it before changing preview data directories.",
    );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_CONCORS_API_URL: apiUrl,
    CONCORS_DATA_DIR: dataDirectory,
    CARGO_TARGET_DIR: targetDirectory,
    CARGO_BUILD_JOBS: process.env["CARGO_BUILD_JOBS"] ?? "2",
    CARGO_PROFILE_DEV_DEBUG: process.env["CARGO_PROFILE_DEV_DEBUG"] ?? "0",
  };
  delete env["CONCORS_DAEMON_MANAGED_CONFIG"];
  print(`Building main ${git(root, "rev-parse", "--short", "HEAD")} against ${apiUrl}`);
  print("Reload restarts local terminal and agent processes. Saved data and login stay in place.");
  // Build the maintenance CLI before touching the running application.
  run("pnpm", ["daemon:build"], env);
  await stopProcesses(previewProcesses(await localProcesses(), targets).apps);
  await stopProcesses(previewProcesses(await localProcesses(), targets).gateways);
  run(process.execPath, [join(root, "packages/daemon/dist/cli.js"), "stop-host"], env);
  // Removing the old resource files also avoids Linux ETXTBSY when Tauri copies bundled Node.
  await rm(join(targetDirectory, "debug/daemon"), { recursive: true, force: true });
  run("pnpm", ["desktop:package:linux", "--debug", "--no-bundle"], env);

  const binary = join(targetDirectory, "debug/concors-desktop");
  const commit = git(root, "rev-parse", "HEAD");
  await writeFile(
    statePath,
    JSON.stringify({ apiUrl, dataDirectory, targetDirectory, commit }, null, 2) + "\n",
    { mode: 0o600 },
  );
  const logDirectory = join(root, "node_modules/.cache/concors-preview");
  await mkdir(logDirectory, { recursive: true });
  const logPath = join(logDirectory, "desktop.log");
  const log = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(binary, [], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await delay(1000);
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Desktop exited during launch. See ${logPath}`);
    child.unref();
    print(`Concors started (PID ${child.pid}), commit ${commit.slice(0, 12)}`);
    print(`Executable: ${binary}\nLog: ${logPath}\nNext update: pnpm desktop:reload`);
  } finally {
    closeSync(log);
  }
}

main().catch((error: unknown) => {
  const status = (error as { status?: number }).status;
  console.error(
    status === 75
      ? "Another desktop reload is already running."
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
});
