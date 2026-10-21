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
// Settings → Plugins: answers the app server calls it makes, with plugins kept beside this script.
if (process.argv[2] === "app-server") {
  const fs = require("node:fs"), path = require("node:path");
  const file = path.join(__dirname, "codex-plugins.json");
  const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { "deploy@openai-curated": true });
  createInterface({ input: process.stdin, terminal: false }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id == null) return;
    let result = {};
    if (message.method === "initialize") result = { userAgent: "codex/0.200.0" };
    if (message.method === "config/batchWrite") {
      const state = load();
      for (const edit of message.params.edits) {
        const id = /^plugins\\."(.*)"\\.enabled$/.exec(edit.keyPath)?.[1];
        if (id) state[id] = edit.value;
      }
      fs.writeFileSync(file, JSON.stringify(state));
      result = { status: "ok" };
    }
    if (message.method === "plugin/installed")
      result = {
        marketplaces: [{
          name: "openai-curated",
          plugins: Object.entries(load()).map(([id, enabled]) => ({
            id, name: id.split("@")[0], installed: true, enabled,
            interface: { displayName: "Deploy", shortDescription: "Ship previews from a chat" },
          })),
        }],
        marketplaceLoadErrors: [],
      };
    process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
  });
  return;
}
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
// Settings → Plugins: ` +
      "`claude plugin list|enable|disable`" +
      String.raw`, with plugins kept beside this script.
if (process.argv[2] === "plugin") {
  const fs = require("node:fs"), path = require("node:path");
  const file = path.join(__dirname, "claude-plugins.json");
  const plugins = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : [
        { id: "release-notes@acme", version: "1.2.0", scope: "user", enabled: true },
        { id: "house-style@acme", version: "0.4.0", scope: "managed", enabled: true },
      ];
  if (process.argv[3] === "enable" || process.argv[3] === "disable") {
    for (const plugin of plugins)
      if (plugin.id === process.argv[4]) plugin.enabled = process.argv[3] === "enable";
    fs.writeFileSync(file, JSON.stringify(plugins));
  } else process.stdout.write(JSON.stringify(plugins));
  return;
}
const rule = "────────────────────────────────────────";
function screen(state) {
  const lines = state === "approval"
    ? [rule, "Do you want to proceed?", "❯ 1. Yes", "  2. No", "Esc to cancel"]
    : [state === "working" ? "✻ Thinking… (12s · ↓ 120 tokens)" : "✻ Cooked for 52s", "                       ● high · /effort", rule, "❯ ", rule, "  ⏵⏵ auto mode on (shift+tab to cycle)" + (state === "working" ? " · esc to interrupt" : "")];
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
