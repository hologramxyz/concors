import { readFile, readlink, readdir, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { basename, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MachineProcess, ProcessSnapshot, WorkspaceProject } from "@concors/protocol";

const execute = promisify(execFile);
export const within = (path: string, root: string) => path === root || path.startsWith(root + sep);

export async function concurrentMap<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        if (item !== undefined) results[index] = await run(item);
      }
    }),
  );
  return results;
}

export function parseProcessStat(value: string) {
  const end = value.lastIndexOf(")");
  const start = value.indexOf("(");
  const fields = value
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const pid = Number(value.slice(0, start).trim());
  const parentPid = Number(fields[1]);
  const ticks = Number(fields[11]) + Number(fields[12]);
  const started = fields[19];
  if (
    start < 0 ||
    end < start ||
    !Number.isInteger(pid) ||
    pid <= 0 ||
    !Number.isInteger(parentPid) ||
    !Number.isFinite(ticks) ||
    started === undefined ||
    !/^\d+$/.test(started)
  )
    throw new Error("Invalid process stat");
  return {
    pid,
    parentPid,
    ticks,
    started,
    name: value.slice(start + 1, end),
    state: fields[0],
  };
}

/** No command arguments or environment variables are sent to clients. */
export function processLabel(name: string, args: string[]) {
  if (["node", "nodejs", "bun", "deno", "python", "python3"].includes(name)) {
    const entry = args[1];
    if (
      entry &&
      !entry.startsWith("-") &&
      /(?:\.[cm]?[jt]s|\.py|\/vite|\/next|\/vitest|\/tsup)$/.test(entry)
    )
      return `${name} · ${basename(entry)}`.slice(0, 160);
  }
  return name.slice(0, 160);
}

export function listeningPorts(output: string) {
  const result = new Map<number, number[]>();
  for (const line of output.split("\n")) {
    const address = line.trim().split(/\s+/)[3];
    const port = Number(address?.match(/:(\d+)$/)?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1]);
      const ports = result.get(pid) ?? [];
      if (!ports.includes(port) && ports.length < 64) ports.push(port);
      result.set(pid, ports);
    }
  }
  return result;
}

export class ProcessInventory {
  #previous = new Map<string, number>();
  #total = 0;
  #snapshot: ProcessSnapshot | null = null;
  #pending: Promise<ProcessSnapshot> | null = null;
  #identities = new Map<
    string,
    { pid: number; started: string; uid: number; blocked: string | null }
  >();
  private readonly projects: () => readonly WorkspaceProject[];
  constructor(projects: () => readonly WorkspaceProject[]) {
    this.projects = projects;
  }

  async snapshot(force = false): Promise<ProcessSnapshot> {
    if (this.#pending) return this.#pending;
    if (!force && this.#snapshot && Date.now() - this.#snapshot.sampledAt < 2000)
      return this.#snapshot;
    this.#pending = this.#collect();
    try {
      this.#snapshot = await this.#pending;
      return this.#snapshot;
    } finally {
      this.#pending = null;
    }
  }

  async #collect(): Promise<ProcessSnapshot> {
    if (process.platform !== "linux")
      return {
        sampledAt: Date.now(),
        processes: [],
        warnings: [
          "Process inspection is available on Linux machines. Whole-machine CPU and RAM remain available on other platforms.",
        ],
      };
    const warnings: string[] = [];
    const uid = process.getuid?.() ?? -1;
    const entries = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
    if (entries.length > 8192)
      warnings.push("Process scan limited to 8,192 operating-system entries.");
    const cpu = ((await readFile("/proc/stat", "utf8")).split("\n")[0] ?? "")
      .trim()
      .split(/\s+/)
      .slice(1, 9)
      .map(Number)
      .reduce((a, b) => a + b, 0);
    const delta = cpu - this.#total;
    const all = await concurrentMap(entries.slice(0, 8192), 16, async (entry) => {
      try {
        const metadata = await stat(`/proc/${entry}`);
        if (metadata.uid !== uid) return null;
        const [raw, status, args, directory] = await Promise.all([
          readFile(`/proc/${entry}/stat`, "utf8"),
          readFile(`/proc/${entry}/status`, "utf8"),
          readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => ""),
          readlink(`/proc/${entry}/cwd`).catch(() => null),
        ]);
        const info = parseProcessStat(raw);
        const argv = args.split("\0");
        const memory = status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1];
        return {
          ...info,
          directory,
          uid,
          argv,
          memoryBytes: memory ? Number(memory) * 1024 : null,
        };
      } catch {
        return null;
      } // Processes may exit while being sampled.
    });
    const found = all.filter((p) => p !== null);
    const parents = new Map(found.map((p) => [p.pid, p.parentPid]));
    const protectedPids = new Set<number>([1]);
    for (let pid = process.pid; pid > 0 && !protectedPids.has(pid); pid = parents.get(pid) ?? 0)
      protectedPids.add(pid);
    const ports = await execute("ss", ["-H", "-ltnp"], { timeout: 2000, maxBuffer: 1024 * 1024 })
      .then(({ stdout }) => listeningPorts(stdout))
      .catch(() => {
        warnings.push("Listening ports unavailable; process usage is still shown.");
        return new Map<number, number[]>();
      });
    const next = new Map<string, number>();
    this.#identities.clear();
    const projects = [...this.projects()].sort((a, b) => b.directory.length - a.directory.length);
    const processes: MachineProcess[] = found.slice(0, 4096).map((p) => {
      const id = `${p.pid}:${p.started}`;
      const before = this.#previous.get(id);
      next.set(id, p.ticks);
      const infrastructure = p.argv.some((arg) =>
        /(?:concors[-/]daemon|packages\/daemon\/|concors-daemon|tailscaled|sshd)/.test(arg),
      );
      const blocked =
        protectedPids.has(p.pid) ||
        infrastructure ||
        ["systemd", "dbus-daemon", "sshd", "tailscaled"].includes(p.name)
          ? "Machine connection or daemon infrastructure is protected."
          : p.state === "Z"
            ? "A zombie process must be reaped by its parent."
            : null;
      this.#identities.set(id, { pid: p.pid, started: p.started, uid, blocked });
      return {
        id,
        pid: p.pid,
        parentPid: p.parentPid,
        name: processLabel(p.name, p.argv),
        directory: p.directory,
        projectId:
          projects.find((project) => p.directory && within(p.directory, project.directory))?.id ??
          null,
        cpuPercent:
          before === undefined || this.#total === 0 || delta <= 0
            ? null
            : Math.min(100, Math.max(0, ((p.ticks - before) / delta) * 100)),
        memoryBytes: p.memoryBytes,
        state:
          p.state === "R"
            ? "running"
            : ["S", "D", "I"].includes(p.state ?? "")
              ? "sleeping"
              : ["T", "t"].includes(p.state ?? "")
                ? "stopped"
                : p.state === "Z"
                  ? "zombie"
                  : "unknown",
        ports: ports.get(p.pid) ?? [],
        stopBlocked: blocked,
      };
    });
    if (found.length > 4096) warnings.push("Showing the first 4,096 processes for this OS user.");
    this.#previous = next;
    this.#total = cpu;
    return { sampledAt: Date.now(), processes, warnings };
  }

  async stop(id: string): Promise<void> {
    await this.snapshot(true);
    const target = this.#identities.get(id);
    if (!target) throw new Error("Process exited or changed. Refresh before trying again.");
    if (target.blocked) throw new Error(target.blocked);
    // Synchronous identity recheck immediately before the signal; never signal a process group.
    const current = parseProcessStat(readFileSync(`/proc/${target.pid}/stat`, "utf8"));
    if (current.started !== target.started || statSync(`/proc/${target.pid}`).uid !== target.uid)
      throw new Error("Process identity changed. Nothing was stopped.");
    process.kill(target.pid, "SIGTERM");
    this.#snapshot = null;
  }
}
