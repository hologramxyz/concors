import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installerDirectories, loginShellPath, mergePath, parseShellPath } from "./login-path.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((p) => rm(p, { recursive: true, force: true })));
  directories.length = 0;
});

it("puts the login shell's PATH first and keeps launchd's and the installers' directories", () => {
  const launchd = "/usr/bin:/bin:/usr/sbin:/sbin";
  const shell = "/Users/a/.nvm/bin:/opt/homebrew/bin:/usr/bin:/bin";
  expect(
    mergePath(launchd, shell, installerDirectories("darwin", "/Users/a", {}), "darwin").split(":"),
  ).toEqual([
    "/Users/a/.nvm/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    // Where Claude Code's and OpenCode's own installers put them, even if the shell never says so.
    "/Users/a/.local/bin",
    "/Users/a/.opencode/bin",
    "/Users/a/.claude/local",
    "/Users/a/.bun/bin",
    "/Users/a/.volta/bin",
    "/Users/a/.npm-global/bin",
    "/usr/local/bin",
  ]);
});

it("still finds the installers' directories when the shell cannot answer", () => {
  expect(
    mergePath("/usr/bin:/bin", undefined, installerDirectories("linux", "/home/a", {}), "linux"),
  ).toContain("/home/a/.local/bin");
});

it("merges Windows paths once each, whatever their case", () => {
  const installers = installerDirectories("win32", "C:\\Users\\a", {
    APPDATA: "C:\\Users\\a\\AppData\\Roaming",
  });
  expect(installers).toContain("C:\\Users\\a\\.local\\bin");
  expect(installers).toContain("C:\\Users\\a\\AppData\\Roaming\\npm");
  expect(
    mergePath("C:\\Windows;c:\\users\\a\\appdata\\roaming\\npm", undefined, installers, "win32")
      .split(";")
      .filter((entry) => entry.toLowerCase().endsWith("\\npm")),
  ).toHaveLength(1);
});

it("reads the PATH between its markers whatever an interactive shell prints around it", () => {
  expect(parseShellPath("Welcome!\n__CONCORS_PATH__/a:/b__CONCORS_PATH__\nbye")).toBe("/a:/b");
  expect(parseShellPath("no markers here")).toBeUndefined();
  expect(parseShellPath("__CONCORS_PATH____CONCORS_PATH__")).toBeUndefined();
});

it.skipIf(process.platform === "win32")("asks a real login shell for its PATH", async () => {
  expect(await loginShellPath("/bin/sh")).toMatch(/\//);
});

it.skipIf(process.platform === "win32")(
  "gives up on a shell that never answers or does not exist",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "concors-login-path-"));
    directories.push(directory);
    const stuck = join(directory, "stuck-shell");
    await writeFile(stuck, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const started = Date.now();
    expect(await loginShellPath(stuck, 200)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await loginShellPath(join(directory, "missing-shell"))).toBeUndefined();
  },
);
