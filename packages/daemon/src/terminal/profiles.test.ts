import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { defaultShell, resolveProfile } from "./profiles.ts";

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
    expect(resolveProfile("codex", process.platform, { PATH: directory }, true).args).toEqual([
      "resume",
    ]);
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
    expect(
      resolveProfile("claude", "win32", { PATH: directory, ComSpec: "cmd.exe" }, true).args,
    ).toContain(" --resume");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("opens PowerShell on Windows, preferring PowerShell 7, and cmd only without either", () => {
  const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
  const windowsPowerShell = "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const env = {
    Path: "C:\\Windows\\system32;C:\\Program Files\\PowerShell\\7\\",
    SystemRoot: "D:\\Win",
    ComSpec: "D:\\Win\\system32\\cmd.exe",
  };
  const installed =
    (...files: string[]) =>
    (path: string) =>
      files.includes(path);
  expect(defaultShell("win32", env, installed(pwsh, windowsPowerShell))).toEqual({
    command: pwsh,
    args: ["-NoLogo"],
  });
  expect(defaultShell("win32", env, installed(windowsPowerShell))).toEqual({
    command: windowsPowerShell,
    args: ["-NoLogo"],
  });
  expect(defaultShell("win32", env, installed())).toEqual({
    command: "D:\\Win\\system32\\cmd.exe",
    args: [],
  });
  // Variable names are matched regardless of case, as Windows does.
  const builtIn = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  expect(
    defaultShell("win32", { PATH: "C:\\Program Files\\PowerShell\\7" }, installed(pwsh)),
  ).toMatchObject({ command: pwsh });
  expect(defaultShell("win32", {}, installed(builtIn))).toMatchObject({ command: builtIn });
  // Elsewhere the person's own shell, and nothing is probed.
  expect(defaultShell("linux", { SHELL: "/usr/bin/fish" }, installed(pwsh))).toEqual({
    command: "/usr/bin/fish",
    args: [],
  });
  expect(defaultShell("darwin", {}, installed())).toMatchObject({ command: "/bin/sh" });
});
