import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TerminalInfo } from "@concors/protocol";

const execute = promisify(execFile);
type Agent = NonNullable<TerminalInfo["detectedAgent"]>;
export interface TerminalProcess {
  pid: number;
  parentPid: number;
  command: string;
}

/** Match executables and CLI entrypoints, never arbitrary prompt/output text. */
export function agentCommand(command: string): Agent | null {
  const tokens = [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const name = (value: string) => value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const executable = name(tokens[0] ?? "").replace(/\.exe$/i, "");
  if (executable === "codex" || executable === "claude" || executable === "opencode")
    return executable;
  if (!["node", "nodejs", "bun", "deno"].includes(executable)) return null;
  // npm shims launch a runtime with the CLI script as its first argument.
  const script = (tokens[1] ?? "").replaceAll("\\", "/");
  const entry = name(script);
  if (/^codex\.(?:[cm]?js)$/.test(entry)) return "codex";
  if (/^claude\.(?:[cm]?js)$/.test(entry) || /\/@anthropic-ai\/claude-code\/cli\.js$/.test(script))
    return "claude";
  if (entry === "opencode" || /^opencode\.(?:[cm]?js)$/.test(entry)) return "opencode";
  return null;
}

export function detectTerminalAgent(
  rootPid: number,
  processes: readonly TerminalProcess[],
): Agent | null {
  const children = new Map<number, TerminalProcess[]>();
  for (const process of processes) {
    const group = children.get(process.parentPid) ?? [];
    group.push(process);
    children.set(process.parentPid, group);
  }
  const queue = [rootPid];
  const seen = new Set<number>();
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  for (const pid of queue) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    const command = byPid.get(pid)?.command;
    const agent = command ? agentCommand(command) : null;
    if (agent) return agent;
    for (const child of children.get(pid) ?? []) queue.push(child.pid);
  }
  return null;
}

/** A single bounded process snapshot is shared by every running shell on this machine. */
export async function readTerminalProcesses(): Promise<TerminalProcess[]> {
  const options = { timeout: 3000, maxBuffer: 4 * 1024 * 1024, windowsHide: true };
  if (process.platform === "win32") {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress",
      ],
      options,
    );
    const rows = JSON.parse(stdout) as {
      ProcessId: number;
      ParentProcessId: number;
      CommandLine: string | null;
    }[];
    return rows.map((row) => ({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      command: row.CommandLine ?? "",
    }));
  }
  const { stdout } = await execute("ps", ["-ax", "-ww", "-o", "pid=,ppid=,args="], options);
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] ?? "" }]
      : [];
  });
}
