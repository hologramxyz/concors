import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentProviderName, type TerminalInfo } from "@concors/protocol";
import { commandLabel } from "./command-label.ts";

const execute = promisify(execFile);
type Agent = NonNullable<TerminalInfo["detectedAgent"]>;
export interface TerminalProcess {
  pid: number;
  parentPid: number;
  command: string;
  /** Its process group, where the platform reports one. */
  group?: number;
  /** The process group in the foreground of its terminal; 0 when it has no terminal. */
  foregroundGroup?: number;
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

/**
 * What a shell runs in the foreground, labelled for anyone who can see the terminal, or null while
 * the shell itself has the terminal, waiting at a prompt. Background jobs and the helpers some
 * prompts keep running are in other groups, so they do not count. A coding agent is named, and its
 * arguments, which can hold credentials, are never part of the label.
 */
export function foregroundCommand(
  shellPid: number,
  processes: readonly TerminalProcess[],
): string | null {
  const shell = processes.find((process) => process.pid === shellPid);
  const group = shell?.foregroundGroup;
  if (!shell || !group || group === shell.group) return null;
  const members = processes.filter((process) => process.group === group);
  const leader = members.find((process) => process.pid === group) ?? members[0];
  if (!leader) return null;
  for (const process of [leader, ...members]) {
    const agent = agentCommand(process.command);
    if (agent) return agentProviderName(agent);
  }
  return commandLabel(leader.command);
}

/** A single bounded process snapshot is shared by every running shell on this machine. */
export async function readTerminalProcesses(): Promise<TerminalProcess[]> {
  const maxBuffer = 4 * 1024 * 1024;
  if (process.platform === "win32") {
    // Starting PowerShell and the first CIM query can take several seconds on a cold machine;
    // scans are serialized by the caller, so a generous budget cannot pile up.
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CommandLine | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress",
      ],
      { timeout: 15_000, maxBuffer, windowsHide: true },
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
  const { stdout } = await execute("ps", ["-ax", "-ww", "-o", "pid=,ppid=,pgid=,tpgid=,args="], {
    timeout: 3000,
    maxBuffer,
  });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            group: Number(match[3]),
            foregroundGroup: Math.max(0, Number(match[4])),
            command: match[5] ?? "",
          },
        ]
      : [];
  });
}
