import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { directoryIdentity, oscDirectory, shellDirectory } from "./working-directory.ts";

it("accepts only local absolute OSC 7 directories", () => {
  expect(oscDirectory(pathToFileURL(join(tmpdir(), "folder with spaces")).href)).toBe(
    join(tmpdir(), "folder with spaces"),
  );
  for (const value of [
    "https://example.com/project",
    "file://remote-machine/home/dev",
    "file:///tmp/%00bad",
    "file:///tmp/path?query",
    "not a uri",
  ])
    expect(oscDirectory(value)).toBeNull();
});
it.skipIf(process.platform === "win32")(
  "reads the real process directory without shell integration",
  async () => {
    expect(await shellDirectory(process.pid)).toBe(await realpath(process.cwd()));
    expect(await shellDirectory(2147483647)).toBeNull();
  },
);
it("keeps repo subdirectories under one identity and worktrees under their own", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "concors-identity-"));
  try {
    const root = await realpath(temporary),
      repo = join(root, "repo"),
      worktree = join(root, "review");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "README.md"), "hello");
    execFileSync("git", ["init", repo], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "Fixture",
      ],
      { stdio: "ignore" },
    );
    execFileSync("git", ["-C", repo, "worktree", "add", "-b", "review", worktree], {
      stdio: "ignore",
    });
    expect(await directoryIdentity(join(repo, "src"))).toEqual({
      directory: join(repo, "src"),
      root: repo,
    });
    expect(await directoryIdentity(worktree)).toEqual({ directory: worktree, root: worktree });
    expect(await directoryIdentity(root)).toEqual({ directory: root, root });
    await expect(directoryIdentity(join(root, "missing"))).rejects.toThrow();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
