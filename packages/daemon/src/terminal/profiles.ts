import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join, resolve } from "node:path";
import type { TerminalProfile } from "@concors/protocol";

export function resolveProfile(
  profile: TerminalProfile,
  platform = process.platform,
  env = process.env,
  resume = false,
): { command: string; args: string[] | string } {
  if (profile === "shell")
    return {
      command:
        platform === "win32"
          ? (env["ComSpec"] ?? env["COMSPEC"] ?? "cmd.exe")
          : (env["SHELL"] ?? "/bin/sh"),
      args: [],
    };
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
          const doubleEscape = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i.test(candidate);
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
