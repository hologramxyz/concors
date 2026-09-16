import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readlink, realpath, rename, rm, statfs, access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { StorageEntry, StorageSnapshot, WorkspaceProject } from "@concors/protocol";
import { concurrentMap, within } from "./processes.ts";

const execute = promisify(execFile);
const git = (directory: string, args: string[]) =>
  execute("git", ["-C", directory, ...args], {
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  }).then(({ stdout }) => stdout);
interface Candidate {
  entry: StorageEntry;
  fingerprint: string;
  repository?: string;
  main?: boolean;
  locked?: boolean;
}

export function parseWorktrees(output: string) {
  const result: { path: string; branch: string | null; locked: boolean; main: boolean }[] = [];
  let current: (typeof result)[number] | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice(9), branch: null, locked: false, main: result.length === 0 };
      result.push(current);
    } else if (current && field.startsWith("branch "))
      current.branch = field.slice(7).replace(/^refs\/heads\//, "");
    else if (current && (field === "locked" || field.startsWith("locked "))) current.locked = true;
  }
  return result;
}

/** Metadata fingerprint, no symlink traversal, one filesystem, bounded IO. */
export async function inspectTree(path: string) {
  const root = await lstat(path);
  const hash = createHash("sha256");
  let bytes = 0;
  let count = 0;
  let hasGit = false;
  const deadline = Date.now() + 2000;
  const visit = async (file: string): Promise<void> => {
    if (++count > 50_000 || Date.now() > deadline)
      throw new Error("Directory is too large to verify safely in one scan.");
    const meta = await lstat(file);
    if (meta.dev !== root.dev) throw new Error("Contains another mounted filesystem.");
    if (process.getuid && meta.uid !== process.getuid())
      throw new Error("Contains files owned by another OS user.");
    if (basename(file) === ".git") hasGit = true;
    hash.update(
      `${file}\0${meta.dev}:${meta.ino}:${meta.mode}:${meta.size}:${meta.mtimeMs}:${meta.ctimeMs}\0`,
    );
    bytes += meta.blocks * 512;
    if (meta.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(join(file, name));
    } else if (!meta.isFile() && !meta.isSymbolicLink())
      throw new Error("Contains sockets or other non-file resources.");
  };
  await visit(path);
  return { fingerprint: hash.digest("hex"), bytes, hasGit };
}

/** Same-user references plus container bind mounts, rechecked before any removal. */
export async function activePaths(
  includeFiles = false,
): Promise<{ paths: string[]; mounts: string[]; uncertain: boolean }> {
  if (process.platform !== "linux") return { paths: [], mounts: [], uncertain: true };
  const mounted: string[] = [];
  const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  let uncertain = pids.length > 8192;
  const groups = await concurrentMap(pids.slice(0, 8192), 12, async (pid) => {
    const directory = `/proc/${pid}`;
    try {
      if ((await lstat(directory)).uid !== process.getuid?.()) return [];
      const paths: string[] = [];
      const cwd = await readlink(`${directory}/cwd`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") uncertain = true;
        return null;
      });
      if (cwd) paths.push(cwd);
      if (includeFiles) {
        const files = await readdir(`${directory}/fd`);
        if (files.length > 8192) uncertain = true;
        for (const name of files.slice(0, 8192)) {
          const target = await readlink(`${directory}/fd/${name}`).catch(() => null);
          if (target?.startsWith("/")) paths.push(target.replace(/ \(deleted\)$/, ""));
        }
      }
      return paths;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") uncertain = true;
      return [];
    }
  });
  if (
    includeFiles &&
    (await access("/var/run/docker.sock").then(
      () => true,
      () => false,
    ))
  ) {
    try {
      const args = ["--host", "unix:///var/run/docker.sock"];
      const { stdout: ids } = await execute("docker", [...args, "ps", "-aq"], {
        timeout: 3000,
        maxBuffer: 100_000,
      });
      const containers = ids.trim().split(/\s+/).filter(Boolean);
      if (containers.length > 256) throw new Error("Too many containers to verify.");
      if (containers.length) {
        const { stdout } = await execute(
          "docker",
          [...args, "inspect", "--format", "{{json .Mounts}}", ...containers],
          { timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
        );
        for (const line of stdout.trim().split("\n")) {
          const mounts: { Source?: string }[] = JSON.parse(line);
          mounted.push(...mounts.flatMap((mount) => (mount.Source ? [mount.Source] : [])));
        }
      }
    } catch {
      uncertain = true;
    }
  }
  return { paths: groups.flat(), mounts: mounted, uncertain };
}

export class StorageInventory {
  #candidates = new Map<string, Candidate>();
  #scanning: Promise<StorageSnapshot> | null = null;
  #cleaning = false;
  private readonly projects: () => readonly WorkspaceProject[];
  private readonly roots: { temporary: string[]; caches: string[] };
  private readonly activity: typeof activePaths;
  constructor(
    projects: () => readonly WorkspaceProject[],
    roots = { temporary: [tmpdir(), "/var/tmp"], caches: [join(homedir(), ".cache")] },
    activity: typeof activePaths = activePaths,
  ) {
    this.projects = projects;
    this.roots = roots;
    this.activity = activity;
  }

  async scan(): Promise<StorageSnapshot> {
    if (process.platform !== "linux")
      return {
        scannedAt: Date.now(),
        entries: [],
        volumes: [],
        warnings: ["Storage inspection and cleanup are currently available on Linux machines."],
      };
    if (this.#cleaning) throw new Error("Cleanup is in progress. Wait before scanning again.");
    if (this.#scanning) return this.#scanning;
    this.#scanning = this.#scan();
    try {
      return await this.#scanning;
    } finally {
      this.#scanning = null;
    }
  }

  async #scan(): Promise<StorageSnapshot> {
    const deadline = Date.now() + 20_000;
    const warnings = [
      "Review before deleting. Age and low CPU usage do not establish that something is disposable. Docker volumes and arbitrary home folders are not cleanup targets.",
    ];
    const projects = this.projects();
    const items = new Map<
      string,
      {
        kind: StorageEntry["kind"];
        branch: string | null;
        repository?: string;
        main?: boolean;
        locked?: boolean;
      }
    >();
    for (const project of projects) {
      if (Date.now() > deadline) {
        warnings.push("Worktree discovery reached its time limit.");
        break;
      }
      try {
        const trees = parseWorktrees(
          await git(project.directory, ["worktree", "list", "--porcelain", "-z"]),
        );
        for (const tree of trees)
          items.set(tree.path, {
            kind: "worktree",
            branch: tree.branch,
            repository: project.directory,
            main: tree.main,
            locked: tree.locked,
          });
      } catch {
        /* A workspace need not be a Git repository. */
      }
    }
    for (const [kind, roots] of [
      ["temporary", this.roots.temporary],
      ["cache", this.roots.caches],
    ] as const) {
      for (const root of roots) {
        const names = await readdir(root).catch(() => []);
        for (const name of names.sort()) {
          const path = join(root, name);
          if (items.has(path) || name.startsWith(".concors-cleanup-")) continue;
          try {
            const meta = await lstat(path);
            if (
              meta.uid === process.getuid?.() &&
              !meta.isSymbolicLink() &&
              (meta.isDirectory() || meta.isFile())
            )
              items.set(path, { kind, branch: null });
          } catch {
            /* Concurrent temporary-file removal. */
          }
        }
      }
    }
    if (items.size > 128)
      warnings.push("Showing the first 128 storage entries. Linked worktrees are listed first.");
    const activity = await this.activity();
    const candidates = await concurrentMap(
      [...items].slice(0, 128),
      4,
      async ([path, item]): Promise<Candidate | null> => {
        try {
          const meta = await lstat(path);
          let blocked = meta.isSymbolicLink()
            ? "Symbolic links are not cleanup targets."
            : this.#protected(path);
          if (item.main) blocked = "Primary repository checkout is protected.";
          if (item.locked) blocked = "Worktree is locked. Unlock it deliberately in Git first.";
          if (activity.paths.some((active) => within(active, path)))
            blocked ??= "A running process is using this directory.";
          if (activity.uncertain) blocked ??= "Could not verify running-process usage.";
          let fingerprint = "";
          let bytes: number | null = null;
          try {
            if (Date.now() > deadline)
              throw new Error("Scan time limit reached. Retry when the machine is less busy.");
            if (blocked) {
              const { stdout } = await execute("du", ["-sx", "--block-size=1", "--", path], {
                timeout: 1000,
                maxBuffer: 1024,
              });
              const measured = Number(stdout.split(/\s+/)[0]);
              if (Number.isSafeInteger(measured) && measured >= 0) bytes = measured;
            } else {
              const tree = await inspectTree(path);
              fingerprint = tree.fingerprint;
              bytes = tree.bytes;
              if (tree.hasGit && item.kind !== "worktree")
                blocked ??= "Contains a Git checkout. Manage it as a worktree, not temporary junk.";
            }
          } catch (error) {
            blocked ??= message(error);
          }
          if (!blocked && item.kind === "worktree") blocked = await this.#worktreeBlocked(path);
          const filesystem = await statfs(path);
          return {
            entry: {
              id: randomUUID(),
              kind: item.kind,
              path,
              bytes,
              modifiedAt: meta.mtimeMs,
              memoryBacked: filesystem.type === 0x01021994,
              branch: item.branch,
              cleanupBlocked: blocked,
            },
            fingerprint,
            ...(item.repository ? { repository: item.repository } : {}),
            ...(item.main !== undefined ? { main: item.main } : {}),
            ...(item.locked !== undefined ? { locked: item.locked } : {}),
          };
        } catch {
          return null;
        }
      },
    );
    this.#candidates = new Map(
      candidates.filter((item) => item !== null).map((item) => [item.entry.id, item]),
    );
    const volumes = [];
    for (const path of [...new Set([homedir(), ...this.roots.temporary])]) {
      try {
        const fs = await statfs(path);
        volumes.push({
          path,
          totalBytes: fs.blocks * fs.bsize,
          availableBytes: fs.bavail * fs.bsize,
          memoryBacked: fs.type === 0x01021994,
        });
      } catch {
        /* Missing mount. */
      }
    }
    return {
      scannedAt: Date.now(),
      entries: [...this.#candidates.values()].map((item) => item.entry),
      volumes,
      warnings,
    };
  }

  #protected(path: string): string | null {
    if (
      ["/", homedir(), ...this.roots.temporary, ...this.roots.caches].some(
        (root) => resolve(path) === resolve(root),
      )
    )
      return "Storage roots and your home directory are protected.";
    if (
      this.projects().some(
        (project) => within(project.directory, path) || within(path, project.directory),
      )
    )
      return "An open workspace uses this path. Close the workspace before cleanup.";
    return null;
  }

  async #worktreeBlocked(path: string): Promise<string | null> {
    try {
      const status = await git(path, [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--ignored",
      ]);
      if (status.trim())
        return "Contains modified, untracked, or ignored files. Preserve or remove them explicitly first.";
      const unique = await git(path, ["rev-list", "--count", "HEAD", "--not", "--remotes"]);
      if (Number(unique.trim()) !== 0)
        return "Contains commits not reachable from a fetched remote. Push or preserve them first.";
      return null;
    } catch {
      return "Could not verify Git state. Nothing will be removed.";
    }
  }

  async cleanup(id: string, confirmation: string): Promise<string> {
    if (this.#cleaning || this.#scanning)
      throw new Error("Another storage operation is in progress.");
    const target = this.#candidates.get(id);
    if (!target || confirmation !== target.entry.path)
      throw new Error("Review a fresh scan and confirm the exact path first.");
    if (target.entry.cleanupBlocked) throw new Error(target.entry.cleanupBlocked);
    this.#cleaning = true;
    try {
      const path = target.entry.path;
      const blocked = this.#protected(path);
      if (blocked) throw new Error(blocked);
      if ((await realpath(path)) !== path)
        throw new Error("Path now resolves through a symbolic link. Scan again.");
      const activity = await this.activity(true);
      if (activity.uncertain)
        throw new Error("Cannot verify open files or container mounts. Nothing was removed.");
      if (
        activity.paths.some((active) => within(active, path)) ||
        activity.mounts.some((mount) => within(mount, path) || within(path, mount))
      )
        throw new Error(
          "A process or container is using this path. Stop it explicitly before cleanup.",
        );
      const current = await inspectTree(path);
      if (current.fingerprint !== target.fingerprint)
        throw new Error("Files changed since the scan. Review a fresh scan before cleanup.");
      if (target.entry.kind === "worktree") {
        if (!target.repository) throw new Error("Missing worktree repository. Scan again.");
        const trees = parseWorktrees(
          await git(target.repository, ["worktree", "list", "--porcelain", "-z"]),
        );
        const tree = trees.find((item) => item.path === path);
        if (!tree || tree.main || tree.locked)
          throw new Error("Worktree changed or is protected. Scan again.");
        const reason = await this.#worktreeBlocked(path);
        if (reason) throw new Error(reason);
        await git(target.repository, ["worktree", "remove", "--", path]);
      } else {
        if (current.hasGit) throw new Error("Git checkouts cannot be deleted as temporary files.");
        // Move the exact verified entry out of its old name before removal. rm never follows symlinks.
        const staging = join(dirname(path), `.concors-cleanup-${randomUUID()}`);
        await rename(path, staging);
        try {
          await rm(staging, { recursive: true, force: false, maxRetries: 0 });
        } catch {
          throw new Error(
            `Cleanup incomplete. Remaining files are at ${staging}. Inspect them before retrying.`,
          );
        }
      }
      this.#candidates.delete(id);
      return `Removed ${path}. This deletion cannot be undone; Git branches were not deleted.`;
    } finally {
      this.#cleaning = false;
    }
  }
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Could not inspect this path safely.";
}
