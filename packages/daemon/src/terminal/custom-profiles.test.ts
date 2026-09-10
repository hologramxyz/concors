import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveTerminalCommand } from "./profiles.ts";
import { TerminalRuntime } from "./runtime.ts";

it("passes custom arguments literally through the native PTY, including Windows command shims", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concors custom & profiles "));
  const script = join(directory, "args.cjs");
  const args = [
    "two words",
    'a"quote',
    "end\\",
    "",
    "literal & | ; $(echo nope)",
    "%PATH%",
    "!value!",
    "(value)",
  ];
  writeFileSync(
    script,
    'console.log("PROFILE_ARGS:"+JSON.stringify(process.argv.slice(2))); process.stdin.resume();',
  );
  let runtime: TerminalRuntime | undefined;
  try {
    const command = process.platform === "win32" ? join(directory, "runner.cmd") : process.execPath;
    if (process.platform === "win32")
      writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    const launch = resolveTerminalCommand(
      command,
      process.platform === "win32" ? args : [script, ...args],
    );
    runtime = new TerminalRuntime(
      {
        id: randomUUID(),
        projectId: randomUUID(),
        profile: "shell",
        directory,
        status: "starting",
        exitCode: null,
        error: null,
        startedAt: new Date().toISOString(),
        cols: 240,
        rows: 24,
      },
      launch,
      () => undefined,
    );
    let output = "";
    await runtime.attach({
      id: randomUUID(),
      active: () => true,
      send: (event) => {
        if (event.type === "terminal.snapshot" || event.type === "terminal.output")
          output += event.data;
      },
    });
    await expect.poll(() => output).toContain("PROFILE_ARGS:" + JSON.stringify(args));
  } finally {
    await runtime?.stop();
    runtime?.dispose();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 15_000);
