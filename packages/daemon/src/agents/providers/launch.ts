import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import type { AgentProviderId } from "@concors/protocol";
import { resolveProfile } from "../../terminal/profiles.ts";

export function launch(
  provider: AgentProviderId,
  args: string[],
  cwd: string,
  env = process.env,
): ChildProcessWithoutNullStreams {
  const profile = resolveProfile(provider, process.platform, env);
  // cross-spawn handles npm's Windows shims and preserves argument boundaries, including JSON.
  return spawn(process.platform === "win32" ? provider : profile.command, args, {
    cwd,
    env,
    stdio: "pipe",
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
}
