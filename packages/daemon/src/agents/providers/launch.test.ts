import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { expect, it } from "vitest";
import { launch } from "./launch.ts";

it("preserves CLI argument boundaries through paths with spaces and Windows npm shims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors provider launch "));
  const script = join(directory, "arguments.cjs");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  try {
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    await writeFile(
      join(directory, process.platform === "win32" ? "pi.cmd" : "pi"),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
      { mode: 0o755 },
    );
    const args = [
      "--model",
      "provider/model",
      "a path with spaces",
      JSON.stringify({ title: 'quotes " and & pipes | caret ^ percent %' }),
    ];
    const processChild = launch("pi", args, directory, {
      ...process.env,
      PATH: directory + delimiter + (process.env["PATH"] ?? ""),
    });
    let stdout = "";
    processChild.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    processChild.stderr.resume();
    const code = await new Promise<number | null>((resolve, reject) => {
      processChild.once("error", reject);
      processChild.once("close", resolve);
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(args);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
