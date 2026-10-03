import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { delimiter, extname, join, resolve, win32 } from "node:path";
import type { TerminalProfile, AgentProviderId } from "@concors/protocol";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Windows variable names ignore case, and a copied environment keeps whichever spelling it had. */
function variable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return (
    env[name] ?? Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1]
  );
}

/**
 * The shell a new terminal opens: the person's `SHELL`, and on Windows PowerShell rather than
 * cmd.exe, as Windows Terminal and VS Code open. PowerShell 7 (`pwsh`) when it is installed,
 * else the Windows PowerShell every Windows ships; cmd.exe only where neither can be found.
 */
export function defaultShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = isFile,
): { command: string; args: string[] } {
  if (platform !== "win32") return { command: env["SHELL"] ?? "/bin/sh", args: [] };
  const pwsh = (variable(env, "PATH") ?? "")
    .split(";")
    .filter(Boolean)
    .map((directory) => win32.join(directory, "pwsh.exe"))
    .find(exists);
  const windowsPowerShell = win32.join(
    variable(env, "SystemRoot") ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const powerShell = pwsh ?? (exists(windowsPowerShell) ? windowsPowerShell : undefined);
  // -NoLogo drops the banner (and Windows PowerShell's upgrade advert) from every new tab.
  if (powerShell) return { command: powerShell, args: ["-NoLogo"] };
  return { command: variable(env, "ComSpec") ?? "cmd.exe", args: [] };
}

export function resolveProfile(
  profile: TerminalProfile | AgentProviderId,
  platform = process.platform,
  env = process.env,
  resume = false,
): { command: string; args: string[] | string } {
  if (profile === "shell") return defaultShell(platform, env);
  // Open the provider's conversation picker; never guess a conversation or replay a prompt.
  const args = resume
    ? profile === "codex"
      ? ["resume"]
      : profile === "claude"
        ? ["--resume"]
        : []
    : [];
  return resolveTerminalCommand(profile, args, platform, env);
}

// Argument quoting adapted from cross-spawn (MIT); see third-party/cross-spawn-LICENSE.
const cmdMeta = /([()\][%!^"`<>&|;, *?])/g;
function cmdArgument(value: string, doubleEscape: boolean): string {
  if (/^[\w./:-]+$/.test(value)) return value;
  let escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`.replace(cmdMeta, "^$1");
  return doubleEscape ? escaped.replace(cmdMeta, "^$1") : escaped;
}

export function resolveTerminalCommand(
  command: string,
  args: string[],
  platform = process.platform,
  env = process.env,
  cwd = process.cwd(),
): { command: string; args: string[] | string } {
  const names =
    platform === "win32" && !extname(command)
      ? [command + ".exe", command + ".com", command + ".cmd", command + ".bat", command]
      : [command];
  const directories = /[\\/]/.test(command)
    ? [cwd]
    : (env["PATH"] ?? env["Path"] ?? "").split(platform === "win32" ? ";" : delimiter);
  for (const directory of directories) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = /[\\/]/.test(command) ? resolve(directory, name) : join(directory, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        if (platform === "win32" && [".cmd", ".bat"].includes(extname(candidate).toLowerCase())) {
          // Adapted from Paseo a7a708b terminal.ts; Apache-2.0, see third-party/paseo-LICENSE.
          // ConPTY cannot execute npm .cmd shims directly. Pass a cmd.exe command line,
          // bypassing node-pty's executable argv quoting. Escape each argument separately.
          const escaped = candidate.replace(cmdMeta, "^$1");
          // Global npm shims and user launchers also forward through %*, outside
          // node_modules/.bin. Their second cmd parse needs a second escaping pass.
          const doubleEscape =
            /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i.test(candidate) ||
            readFileSync(candidate, "utf8").includes("%*");
          const argumentsLine = args.map((arg) => cmdArgument(arg, doubleEscape)).join(" ");
          return {
            command: env["ComSpec"] ?? env["COMSPEC"] ?? "cmd.exe",
            args: `/d /s /c "${escaped}${args.length ? ` ${argumentsLine}` : ""}"`,
          };
        }
        return { command: candidate, args };
      } catch {
        /* Try the next PATH candidate. */
      }
    }
  }
  throw new Error(`${command} is not installed on this machine or is missing from PATH`);
}
