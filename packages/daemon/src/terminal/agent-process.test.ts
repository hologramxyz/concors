import { expect, it } from "vitest";
import { agentCommand, detectTerminalAgent } from "./agent-process.ts";

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
