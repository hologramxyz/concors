import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import spawn from "cross-spawn";

/**
 * The PATH agent CLIs are looked up on. An app opened from the Dock or Finder starts with
 * launchd's `/usr/bin:/bin:/usr/sbin:/sbin`, and a Linux desktop entry with its session's bare
 * PATH, so a `claude` in `~/.local/bin` or an `opencode` in `~/.opencode/bin` that works in every
 * terminal was invisible to chats. The session host therefore asks the person's login shell for its
 * PATH once at startup, as a terminal would see it, and also keeps the directories the CLIs' own
 * installers use, which covers a shell that cannot answer and a CLI installed after the host
 * started. It does not import any other variable from the shell.
 */

const MARK = "__CONCORS_PATH__";

/** Where the agent CLIs' own installers, and the usual package managers, put executables. */
export function installerDirectories(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform === "win32") {
    const appData = env["APPDATA"] ?? win32.join(home, "AppData", "Roaming");
    return [
      win32.join(home, ".local", "bin"),
      win32.join(appData, "npm"),
      win32.join(home, ".opencode", "bin"),
      win32.join(home, "scoop", "shims"),
      win32.join(home, ".bun", "bin"),
    ];
  }
  return [
    posix.join(home, ".local", "bin"),
    posix.join(home, ".opencode", "bin"),
    posix.join(home, ".claude", "local"),
    posix.join(home, ".bun", "bin"),
    posix.join(home, ".volta", "bin"),
    posix.join(home, ".npm-global", "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
  ];
}

/**
 * The login shell's entries first, as in a terminal, then the ones the host started with, then the
 * installer directories; each directory once. Windows compares directories without case.
 */
export function mergePath(
  current: string | undefined,
  shell: string | undefined,
  installers: readonly string[],
  platform: NodeJS.Platform,
): string {
  const separator = platform === "win32" ? ";" : ":";
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of [
    ...(shell ?? "").split(separator),
    ...(current ?? "").split(separator),
    ...installers,
  ]) {
    const key = platform === "win32" ? entry.toLowerCase() : entry;
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.join(separator);
}

/** The PATH between the markers, ignoring whatever an interactive shell prints around it. */
export function parseShellPath(output: string): string | undefined {
  const start = output.indexOf(MARK);
  const end = output.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return undefined;
  return output.slice(start + MARK.length, end).trim() || undefined;
}

/**
 * Asks `shell` for its PATH as an interactive login shell, because installers and version managers
 * add themselves to `.zshrc`/`.bashrc` as often as to the login profile. Resolves undefined on any
 * failure or after `timeoutMs`; a shell waiting on a prompt reads end-of-file instead.
 */
export function loginShellPath(shell: string, timeoutMs = 5000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      // Separate arguments: `$PATH` directly followed by the marker would name another variable.
      child = spawn(shell, ["-ilc", `printf '%s%s%s' ${MARK} "$PATH" ${MARK}`], {
        stdio: ["ignore", "pipe", "ignore"],
        // Keep shell frameworks from offering updates or starting a multiplexer.
        env: { ...process.env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false" },
        windowsHide: true,
      });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      // Interactive shells ignore SIGTERM.
      child.kill("SIGKILL");
      finish(undefined);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1_000_000) output = output.slice(-100_000);
    });
    child.on("error", () => finish(undefined));
    child.on("close", () => finish(parseShellPath(output)));
  });
}

/** Sets this process's PATH to what the person's shell and the CLIs' installers would give. */
export async function adoptLoginPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const shell = platform === "win32" ? undefined : await loginShellPath(env["SHELL"] || "/bin/sh");
  const key =
    platform === "win32"
      ? (Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "Path")
      : "PATH";
  env[key] = mergePath(env[key], shell, installerDirectories(platform, homedir(), env), platform);
}
