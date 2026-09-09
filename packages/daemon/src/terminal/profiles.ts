import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
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
  const names =
    platform === "win32"
      ? [profile + ".exe", profile + ".cmd", profile + ".bat", profile]
      : [profile];
  // Open the provider's conversation picker; never guess a conversation or replay a prompt.
  const args = resume
    ? profile === "codex"
      ? ["resume"]
      : profile === "claude"
        ? ["--resume"]
        : []
    : [];
  for (const directory of (env["PATH"] ?? env["Path"] ?? "").split(
    platform === "win32" ? ";" : delimiter,
  )) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        if (platform === "win32" && [".cmd", ".bat"].includes(extname(candidate).toLowerCase())) {
          // Adapted from Paseo a7a708b terminal.ts; Apache-2.0, see third-party/paseo-LICENSE.
          // ConPTY cannot execute npm .cmd shims directly. Pass a cmd.exe command line,
          // bypassing node-pty's executable argv quoting. No user arguments are interpolated.
          const escaped = candidate.replace(/([()%!^"`<>&|;, *?])/g, "^$1");
          return {
            command: env["ComSpec"] ?? env["COMSPEC"] ?? "cmd.exe",
            args: `/d /s /c "${escaped}${args.length ? ` ${args.join(" ")}` : ""}"`,
          };
        }
        return { command: candidate, args };
      } catch {
        /* Try the next PATH candidate. */
      }
    }
  }
  throw new Error(`${profile} is not installed on this machine or is missing from PATH`);
}
