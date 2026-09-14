import { execFileSync } from "node:child_process";
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function requireCleanMain(root: string): void {
  if (git(root, "branch", "--show-current") !== "main")
    throw new Error(
      "Switch this checkout to main first. No branches or local changes were modified.",
    );
  if (git(root, "status", "--porcelain"))
    throw new Error("Commit or stash local changes first. Reload never discards your work.");
}

export function updateMain(root: string): void {
  requireCleanMain(root);
  execFileSync("git", ["fetch", "origin", "main"], { cwd: root, stdio: "inherit" });
  if (git(root, "rev-list", "origin/main..HEAD"))
    throw new Error("Local main has unpublished commits. Resolve them before reloading.");
  execFileSync("git", ["merge", "--ff-only", "origin/main"], { cwd: root, stdio: "inherit" });
}

export interface LocalProcess {
  pid: number;
  executable: string;
  args: string[];
  dataDirectory?: string;
}

export async function localProcesses(): Promise<LocalProcess[]> {
  const result: LocalProcess[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const directory = join("/proc", name);
      if ((await stat(directory)).uid !== process.getuid?.()) continue;
      const executable = (await readlink(join(directory, "exe"))).replace(/ \(deleted\)$/, "");
      if (!["concors-desktop", "node"].includes(basename(executable))) continue;
      const dataDirectory =
        basename(executable) === "concors-desktop"
          ? (await readFile(join(directory, "environ"), "utf8"))
              .split("\0")
              .find((entry) => entry.startsWith("CONCORS_DATA_DIR="))
              ?.slice("CONCORS_DATA_DIR=".length)
          : undefined;
      result.push({
        ...(dataDirectory ? { dataDirectory } : {}),
        pid: Number(name),
        executable,
        args: (await readFile(join(directory, "cmdline"), "utf8")).split("\0").filter(Boolean),
      });
    } catch {
      // Processes can exit while /proc is being read.
    }
  }
  return result;
}

export function previewProcesses(processes: LocalProcess[], targets: string[]) {
  const binaries = targets.flatMap((target) =>
    ["debug", "release"].map((profile) => resolve(target, profile, "concors-desktop")),
  );
  const apps = processes.filter((item) => binaries.includes(item.executable));
  const otherApp = processes.find(
    (item) =>
      basename(item.executable) === "concors-desktop" && !binaries.includes(item.executable),
  );
  if (otherApp)
    throw new Error(
      `Close the other Concors installation first (${otherApp.executable}), then rerun reload.`,
    );
  const gateways = processes.filter((item) =>
    binaries.some((binary) => {
      const directory = resolve(binary, "..");
      return (
        item.executable === join(directory, "daemon/bin/node") &&
        !!item.args[1] &&
        resolve(item.args[1]) === join(directory, "daemon/lib/cli.js") &&
        item.args[2] === "serve"
      );
    }),
  );
  return { apps, gateways };
}

export async function stopProcesses(processes: LocalProcess[]): Promise<void> {
  for (const item of processes) {
    // Recheck identity immediately before signaling; never trust a stale recorded PID.
    const executable = await readlink(`/proc/${item.pid}/exe`).catch(() => null);
    if (executable?.replace(/ \(deleted\)$/, "") !== item.executable) continue;
    try {
      process.kill(item.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = await localProcesses();
    if (
      !processes.some((item) =>
        alive.some((p) => p.pid === item.pid && p.executable === item.executable),
      )
    )
      return;
    await delay(100);
  }
  throw new Error("Concors is still closing. Close it manually, then rerun reload.");
}
