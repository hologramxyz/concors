import { expect, it } from "vitest";
import { agentCommand, detectTerminalAgent, foregroundCommand } from "./agent-process.ts";

it.each([
  ["/opt/homebrew/bin/codex", "codex"],
  ["/home/me/.local/bin/claude --resume", "claude"],
  ["/usr/bin/node /usr/lib/node_modules/@openai/codex/bin/codex.js", "codex"],
  ["node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js", "claude"],
  ['"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\codex.js"', "codex"],
  ["/usr/bin/bun /opt/opencode/bin/opencode", "opencode"],
  ["opencode.exe", "opencode"],
  ["echo codex", null],
  ["sh -c codex", null],
  ["node -e 'console.log(\"codex\")'", null],
  ["vim /tmp/codex.js", null],
  ["node /tmp/not-codex.js", null],
])("classifies %s by its executable or entrypoint", (command, expected) => {
  expect(agentCommand(command)).toBe(expected);
});

it("follows descendants and exec replacements without borrowing agents from another terminal", () => {
  const processes = [
    { pid: 10, parentPid: 1, command: "/bin/zsh" },
    { pid: 11, parentPid: 10, command: "node /opt/codex.js" },
    { pid: 12, parentPid: 11, command: "/opt/vendor/codex" },
    { pid: 20, parentPid: 1, command: "/bin/zsh" },
    { pid: 21, parentPid: 20, command: "claude" },
    { pid: 30, parentPid: 1, command: "/bin/sh" },
  ];
  expect(detectTerminalAgent(10, processes)).toBe("codex");
  expect(detectTerminalAgent(20, processes)).toBe("claude");
  expect(detectTerminalAgent(30, processes)).toBeNull();
  expect(detectTerminalAgent(12, processes)).toBe("codex");
  expect(
    detectTerminalAgent(
      10,
      processes.filter((p) => p.pid !== 11 && p.pid !== 12),
    ),
  ).toBeNull();
});

it("reports a shell's foreground job, never its prompt helpers or background jobs", () => {
  const shell = (pid: number, foregroundGroup: number) => ({
    pid,
    parentPid: 1,
    group: pid,
    foregroundGroup,
    command: "-zsh",
  });
  const processes = [
    // Waiting at a prompt, with a prompt helper and a background job running.
    shell(10, 10),
    { pid: 11, parentPid: 10, group: 11, foregroundGroup: 10, command: "gitstatusd -s 1" },
    { pid: 12, parentPid: 10, group: 12, foregroundGroup: 10, command: "sleep 600" },
    // Running a command in the foreground.
    shell(20, 21),
    { pid: 21, parentPid: 20, group: 21, foregroundGroup: 21, command: "API_KEY=x npm run dev" },
    { pid: 22, parentPid: 21, group: 21, foregroundGroup: 21, command: "node vite.js" },
    // Running a coding agent, whose arguments may carry a token.
    shell(30, 31),
    { pid: 31, parentPid: 30, group: 31, foregroundGroup: 31, command: "claude --mcp-config x" },
  ];
  expect(foregroundCommand(10, processes)).toBeNull();
  expect(foregroundCommand(20, processes)).toBe("npm run dev");
  expect(foregroundCommand(30, processes)).toBe("Claude Code");
  // Platforms without process groups report nothing rather than guess.
  expect(foregroundCommand(1, [{ pid: 1, parentPid: 0, command: "cmd.exe" }])).toBeNull();
});
