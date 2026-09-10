import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentProviderId } from "@concors/protocol";
import { resolveProfile } from "../../terminal/profiles.ts";
export function launch(
  provider: AgentProviderId,
  args: string[],
  cwd: string,
  env = process.env,
): ChildProcessWithoutNullStreams {
  const profile = resolveProfile(provider, process.platform, env);
  // Resolve npm cmd/bat shims through the same escaping used by terminal profiles.
  const escaped = args.map((arg) => arg.replace(/([()%!^"`<>&|;, *?])/g, "^$1")).join(" ");
  return spawn(
    profile.command,
    typeof profile.args === "string"
      ? ["/d", "/s", "/c", profile.args.slice("/d /s /c ".length, -1) + ` ${escaped}"`]
      : args,
    {
      cwd,
      env,
      stdio: "pipe",
      windowsHide: true,
      ...(typeof profile.args === "string" ? { windowsVerbatimArguments: true } : {}),
    },
  );
}
