import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A real, harmless PTY executable for acceptance tests; never imported by the production CLI. */
export function installTestCodexProfile(directory: string): string {
  const bin = join(directory, "test-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "codex-fixture.cjs");
  writeFileSync(
    script,
    `
process.stdout.write("CODEX_TERMINAL_READY\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (data.trim() === "fail") process.exit(7);
  if (data.trim() === "exit") process.exit(0);
  process.stdout.write("CODEX_REPLY:" + data.trim() + "\\n");
});
process.stdin.resume();
`,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    join(bin, process.platform === "win32" ? "codex.cmd" : "codex"),
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}"\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)}\n`,
    { mode: 0o755 },
  );
  return bin;
}
