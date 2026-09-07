import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { resolveProfile } from "./profiles.ts";

it("resolves installed agent executables and rejects missing profiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "concors-profiles-"));
  try {
    const executable = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    writeFileSync(executable, "test executable");
    chmodSync(executable, 0o755);
    expect(resolveProfile("codex", process.platform, { PATH: directory })).toEqual({
      command: executable,
      args: [],
    });
    expect(() => resolveProfile("claude", process.platform, { PATH: directory })).toThrow(
      "not installed",
    );
    expect(() => resolveProfile("opencode", process.platform, { PATH: directory })).toThrow(
      "not installed",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("routes Windows npm CLI shims through cmd with escaped metacharacters", () => {
  const directory = mkdtempSync(join(tmpdir(), "concors profiles&"));
  try {
    writeFileSync(join(directory, "claude.cmd"), "@echo off");
    const result = resolveProfile("claude", "win32", { PATH: directory, ComSpec: "cmd.exe" });
    expect(result.command).toBe("cmd.exe");
    expect(result.args).toContain("/d /s /c");
    expect(result.args).toContain("^&");
    expect(result.args).toContain("^ ");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
