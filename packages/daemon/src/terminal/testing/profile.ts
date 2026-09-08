import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A real, harmless PTY executable for acceptance tests; never imported by the production CLI. */
export function installTestCodexProfile(directory: string): string {
  const bin = join(directory, "test-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "codex.cjs");
  writeFileSync(
    script,
    `
const { createInterface } = require("node:readline");
const lines = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
lines.on("line", (data) => {
  if (data.trim() === "test-working") process.stdout.write("\\x1b]0;⠙ Test turn\\x07");
  if (data.trim() === "test-idle") process.stdout.write("\\x1b]0;Codex\\x07");
  if (data.trim() === "test-approval") process.stdout.write("\\x1b]0;Action Required\\x07");
  if (data.trim() === "fail") process.exit(7);
  if (data.trim() === "exit") process.exit(0);
  process.stdout.write("CODEX_REPLY:" + data.trim() + "\\n");
});
process.stdout.write("CODEX_TERMINAL_READY\\n");
process.stdout.write("SESSION_PID:" + process.pid + "\\n");
if (process.argv.includes("resume") || process.argv.includes("--resume")) process.stdout.write("RECOVERY_PICKER_READY\\n");
`,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    join(bin, process.platform === "win32" ? "codex.cmd" : "codex"),
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
    { mode: 0o755 },
  );
  return bin;
}

/** Claude-style screen redraws without OSC titles; exercises the fallback used by real CLIs. */
export function installTestClaudeProfile(directory: string): string {
  const bin = join(directory, "test-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "claude.cjs");
  writeFileSync(
    script,
    String.raw`
const { createInterface } = require("node:readline");
const rule = "────────────────────────────────────────";
function screen(state) {
  const lines = state === "approval"
    ? [rule, "Do you want to proceed?", "❯ 1. Yes", "  2. No", "Esc to cancel"]
    : [state === "working" ? "✻ Thinking… (12s · ↓ 120 tokens)" : "✻ Cooked for 52s", rule, "❯ ", rule, "  ⏵⏵ auto mode on (shift+tab to cycle)"];
  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\r\n"));
}
createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity }).on("line", data => {
  const command = data.trim();
  if (command === "exit") process.exit(0);
  if (command.startsWith("test-")) screen(command.slice(5));
});
screen("idle");
`,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    join(bin, process.platform === "win32" ? "claude.cmd" : "claude"),
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
    { mode: 0o755 },
  );
  return bin;
}
