/**
 * Tracks each installed agent CLI's version against its newest npm release. Vendors gate new
 * models on the CLI version (Claude Code's catalog carries a minimum version, Codex filters its
 * remote list by client version), so an outdated CLI quietly hides the models people expect.
 *
 * It only reads versions on its own. An update runs only when a user asks for it, and only with a
 * command scoped to that one tool; installs the daemon cannot attribute get no command, and the
 * user updates them the way they installed them.
 */
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import spawn from "cross-spawn";
import type { ProviderVersion } from "@concors/protocol";
import { killTree } from "../../host/kill-tree.ts";

/** How often installed versions and the registry are re-read while the daemon runs. */
const CHECK_INTERVAL_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

export function parseVersion(output: string): string | undefined {
  return /(?:^|[^\d.])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(output)?.[1];
}

/** Semver precedence, which is all npm release versions need. */
export function compareVersions(a: string, b: string): number {
  const [coreA = "", preA] = a.split(/-(.*)/s),
    [coreB = "", preB] = b.split(/-(.*)/s);
  const partsA = coreA.split(".").map(Number),
    partsB = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
  return Math.sign(preA.localeCompare(preB, "en", { numeric: true }));
}

export interface Install {
  engine: string;
  /** The npm package the CLI is published as, without a version. */
  package: string;
  /** Where the executable really lives, symlinks and version-manager wrappers followed. */
  path: string;
  /** The executable as the daemon launches it, for tools that update themselves. */
  command: string;
  /** Concors' own install prefix for this provider (Settings → Providers → Install). */
  prefix: string;
}

/**
 * The command that updates exactly this install, or undefined when the install method is unknown.
 * Package managers are only used when the path proves they own the install: a global `npm -g`
 * aimed at the wrong prefix, or a `mise upgrade` of every tool, would change more than asked.
 */
export function updateCommand(install: Install): string[] | undefined {
  const path = install.path.split(sep).join("/");
  const latest = `${install.package}@latest`;
  if (path.startsWith(install.prefix.split(sep).join("/") + "/"))
    return [
      "npm",
      "install",
      "--prefix",
      install.prefix,
      "--no-audit",
      "--no-fund",
      "--save-exact",
      latest,
    ];
  // mise keeps each tool in installs/<tool>/<version>; backend-qualified tools (npm:…) are stored
  // under an encoded name that `mise upgrade` does not accept, so they fall through.
  const mise = /\/mise\/installs\/([a-z0-9][a-z0-9_.]*)\//.exec(path)?.[1];
  if (mise && mise !== "node") return ["mise", "upgrade", mise];
  const modules = path.indexOf("/node_modules/");
  if (modules > 0) {
    // A global install lives in <prefix>/lib/node_modules (Unix) or <prefix>/node_modules (Windows).
    const root = install.path.slice(0, modules);
    const prefix = basename(root) === "lib" ? dirname(root) : root;
    return ["npm", "install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", latest];
  }
  const cask = /\/Caskroom\/([^/]+)\//.exec(path)?.[1];
  if (cask) return ["brew", "upgrade", "--cask", cask];
  const formula = /\/Cellar\/([^/]+)\//.exec(path)?.[1];
  if (formula) return ["brew", "upgrade", formula];
  if (install.engine === "claude" && /\/\.local\/share\/claude\/|\/\.claude\/local\//.test(path))
    return [install.command, "update"];
  if (install.engine === "opencode" && path.includes("/.opencode/bin/"))
    return [install.command, "upgrade"];
  return undefined;
}

export interface VersionTarget {
  id: string;
  label: string;
  engine: string;
  package: string;
  prefix: string;
  /** The launched executable and its environment; undefined when the CLI is not installed. */
  executable(): { command: string; args: string[]; env: NodeJS.ProcessEnv } | undefined;
}
type Run = (
  argv: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<{ code: number | null; output: string }>;

export const runCommand: Run = (argv, env, timeoutMs) =>
  new Promise((resolve) => {
    const [command = "", ...args] = argv;
    let output = "";
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const collect = (chunk: Buffer) => {
      if (output.length < 64_000) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, output });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

export async function npmLatest(pkg: string): Promise<string | undefined> {
  const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === "string" ? parseVersion(body.version) : undefined;
}

/** Reads a small text launcher; binaries and large files are not wrapper scripts. */
function script(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(4096);
    const text = buffer.subarray(0, readSync(fd, buffer, 0, 4096, 0)).toString("utf8");
    return text.startsWith("#!") ? text : "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Follows symlinks, and asks mise for the real binary when the command is a mise shim or a
 * wrapper script that runs one, so the install method can be told from the path.
 */
async function locate(
  command: string,
  env: NodeJS.ProcessEnv,
  run: Run,
): Promise<string | undefined> {
  let path: string;
  try {
    path = realpathSync(command);
  } catch {
    return undefined;
  }
  const normalized = path.split(sep).join("/");
  if (
    !normalized.includes("/mise/installs/") &&
    (normalized.includes("/mise/shims/") || /\bmise\s/.test(script(path)))
  ) {
    const which = await run(["mise", "which", basename(command)], env, PROBE_TIMEOUT_MS);
    const real = which.code === 0 ? which.output.trim().split("\n")[0] : undefined;
    if (real)
      try {
        return realpathSync(real);
      } catch {
        // mise answered with a path that no longer exists; keep the launcher's own path.
      }
  }
  return path;
}

interface Entry {
  installed?: string | undefined;
  latest?: string | undefined;
  command?: string[] | undefined;
  updating?: boolean;
  updateError?: string | undefined;
}

export class ProviderVersions {
  private entries = new Map<string, Entry>();
  private checking: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private readonly targets: () => VersionTarget[];
  private readonly changed: (ids: string[]) => void;
  private readonly run: Run;
  private readonly latest: (pkg: string) => Promise<string | undefined>;
  constructor(
    targets: () => VersionTarget[],
    /** Called with provider ids whose installed CLI version changed since the previous check. */
    changed: (ids: string[]) => void,
    run: Run = runCommand,
    latest: (pkg: string) => Promise<string | undefined> = npmLatest,
  ) {
    this.targets = targets;
    this.changed = changed;
    this.run = run;
    this.latest = latest;
  }
  get(id: string): ProviderVersion | undefined {
    const entry = this.entries.get(id);
    if (!entry || (!entry.installed && !entry.updating && !entry.updateError)) return undefined;
    const updateAvailable =
      !!entry.installed && !!entry.latest && compareVersions(entry.latest, entry.installed) > 0;
    return {
      ...(entry.installed ? { installed: entry.installed } : {}),
      ...(entry.latest ? { latest: entry.latest } : {}),
      updateAvailable,
      ...(entry.command ? { updateCommand: entry.command.join(" ") } : {}),
      ...(entry.updating ? { updating: true } : {}),
      ...(entry.updateError ? { updateError: entry.updateError } : {}),
    };
  }
  start() {
    if (this.timer || this.closed) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }
  /** Re-reads every installed version and latest release; concurrent callers share one pass. */
  check(): Promise<void> {
    this.checking ??= this.pass().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private async pass() {
    const changed: string[] = [];
    // One at a time: version-manager wrappers may rewrite their own configuration on every run.
    for (const target of this.targets()) {
      if (this.closed) return;
      if (this.entries.get(target.id)?.updating) continue;
      if (await this.probe(target)) changed.push(target.id);
    }
    if (changed.length && !this.closed) this.changed(changed);
  }
  /** Returns whether a previously known installed version changed. */
  private async probe(target: VersionTarget): Promise<boolean> {
    const previous = this.entries.get(target.id);
    const executable = target.executable();
    if (!executable) {
      this.entries.delete(target.id);
      return !!previous?.installed;
    }
    const [result, latest, path] = await Promise.all([
      this.run(
        [executable.command, ...executable.args, "--version"],
        executable.env,
        PROBE_TIMEOUT_MS,
      ),
      this.latest(target.package).catch(() => undefined),
      locate(executable.command, executable.env, this.run),
    ]);
    const installed = result.code === 0 ? parseVersion(result.output) : undefined;
    const command = path
      ? updateCommand({
          engine: target.engine,
          package: target.package,
          path,
          command: executable.command,
          prefix: target.prefix,
        })
      : undefined;
    this.entries.set(target.id, {
      ...previous,
      installed,
      // A failed registry lookup keeps the last known release rather than hiding an update.
      latest: latest ?? previous?.latest,
      command,
    });
    return !!previous?.installed && !!installed && previous.installed !== installed;
  }
  /** Starts the install's own update command; progress is visible through `get`. */
  update(target: VersionTarget) {
    const entry = this.entries.get(target.id);
    if (entry?.updating) return;
    if (!entry?.command)
      throw new Error(
        `Concors can't tell how ${target.label} was installed. Update it the way you installed it.`,
      );
    const executable = target.executable();
    const env = executable?.env ?? process.env;
    this.entries.set(target.id, { ...entry, updating: true, updateError: undefined });
    void this.run(entry.command, env, UPDATE_TIMEOUT_MS).then(async ({ code, output }) => {
      const current = this.entries.get(target.id) ?? {};
      const tail = output.trim().split("\n").slice(-3).join("\n");
      this.entries.set(target.id, {
        ...current,
        updating: false,
        updateError:
          code === 0 ? undefined : `Update failed (exit ${code ?? "unknown"}). ${tail}`.trim(),
      });
      if (this.closed) return;
      if (await this.probe(target)) this.changed([target.id]);
      // Version managers can hold back fresh releases (a minimum release age, a pinned version).
      const after = this.get(target.id);
      if (code === 0 && after?.updateAvailable)
        this.entries.set(target.id, {
          ...this.entries.get(target.id),
          updateError: `The update finished, but ${target.label} is still ${after.installed}. Its installer may be holding ${after.latest} back.`,
        });
    });
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
