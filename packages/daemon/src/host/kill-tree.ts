import { spawn, type ChildProcess } from "node:child_process";

/**
 * Stopping a child together with everything it started. On Windows the agent CLIs are npm `.cmd`
 * shims, which cross-spawn runs through cmd.exe, so the child the daemon holds is cmd.exe and the
 * agent is its child. `child.kill()` there ends cmd.exe alone: the agent keeps running, and since
 * it still holds the stdio pipes it inherited, the child's `close` never comes and whoever waits
 * on it hangs. `taskkill /T` ends the whole tree, by force, which is all Windows offers anyway
 * (every signal Node sends there is TerminateProcess).
 *
 * Elsewhere a child is the CLI itself, so this is exactly `child.kill(signal)`.
 */

/** The command that stops `pid` and its descendants, or undefined where `child.kill` does. */
export function treeKillCommand(
  pid: number | undefined,
  platform: NodeJS.Platform,
): { command: string; args: string[] } | undefined {
  if (platform !== "win32" || pid === undefined) return undefined;
  return { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
}

type Killable = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "kill">;

export function killTree(
  child: Killable,
  signal?: NodeJS.Signals | number,
  platform: NodeJS.Platform = process.platform,
): void {
  // An exited child's pid can already belong to an unrelated process; never taskkill that tree.
  const running = child.exitCode === null && child.signalCode === null;
  const command = running ? treeKillCommand(child.pid, platform) : undefined;
  if (!command) {
    child.kill(signal);
    return;
  }
  const killer = spawn(command.command, command.args, { stdio: "ignore", windowsHide: true });
  // Without taskkill, or refused, at least the direct child goes; once it has exited this is a no-op.
  killer.once("error", () => child.kill(signal));
  killer.once("exit", (code) => {
    if (code !== 0) child.kill(signal);
  });
}
