import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { WorkspaceProject } from "@concors/protocol";
import { inspectTree, parseWorktrees, StorageInventory } from "./storage.ts";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "concors-resource-test-"));
  directories.push(root);
  const path = join(root, "old-build");
  await mkdir(path);
  await writeFile(join(path, "output.txt"), "fixture");
  const projects: WorkspaceProject[] = [];
  const activity = { paths: [] as string[], mounts: [] as string[], uncertain: false };
  const inventory = new StorageInventory(
    () => projects,
    { temporary: [root], caches: [] },
    async () => activity,
  );
  return { root, path, inventory, projects, activity };
}
it("parses locked and detached worktrees with spaces", () => {
  expect(
    parseWorktrees(
      "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /tmp/with space\0HEAD def\0detached\0locked keep\0\0",
    ),
  ).toEqual([
    { path: "/repo", branch: "main", locked: false, main: true },
    { path: "/tmp/with space", branch: null, locked: true, main: false },
  ]);
});
it("does not follow symlinks when measuring a cleanup entry", async () => {
  const { root, path } = await fixture();
  await symlink(root, join(path, "outside"));
  expect((await inspectTree(path)).bytes).toBeGreaterThan(0);
});
it.skipIf(process.platform !== "linux")(
  "requires a daemon-issued candidate and exact path confirmation",
  async () => {
    const { path, inventory } = await fixture();
    const scan = await inventory.scan();
    const entry = scan.entries.find((item) => item.path === path)!;
    expect(entry.cleanupBlocked).toBeNull();
    await expect(inventory.cleanup(randomUUID(), path)).rejects.toThrow("fresh scan");
    await expect(inventory.cleanup(entry.id, "/tmp")).rejects.toThrow("exact path");
    await expect(inventory.cleanup(entry.id, path)).resolves.toContain("cannot be undone");
    await expect(access(path)).rejects.toThrow();
  },
);
it.skipIf(process.platform !== "linux")(
  "refuses changed files and leaves them intact",
  async () => {
    const { path, inventory } = await fixture();
    const entry = (await inventory.scan()).entries[0]!;
    await writeFile(join(path, "output.txt"), "new work");
    await expect(inventory.cleanup(entry.id, path)).rejects.toThrow("changed since");
    expect(await readFile(join(path, "output.txt"), "utf8")).toBe("new work");
  },
);
it.skipIf(process.platform !== "linux")(
  "rechecks process use, container parent mounts, and uncertainty before deletion",
  async () => {
    const { root, path, inventory, activity } = await fixture();
    const entry = (await inventory.scan()).entries[0]!;
    activity.paths.push(join(path, "output.txt"));
    await expect(inventory.cleanup(entry.id, path)).rejects.toThrow("using this path");
    activity.paths = [];
    activity.mounts.push(root);
    await expect(inventory.cleanup(entry.id, path)).rejects.toThrow("using this path");
    activity.mounts = [];
    activity.uncertain = true;
    await expect(inventory.cleanup(entry.id, path)).rejects.toThrow("Cannot verify");
  },
);
it.skipIf(process.platform !== "linux")(
  "protects nested open workspaces and nested Git repositories",
  async () => {
    const { path, inventory, projects } = await fixture();
    projects.push({
      id: randomUUID(),
      name: "active",
      directory: join(path, "project"),
      version: 1,
      tabs: [],
    });
    expect((await inventory.scan()).entries[0]!.cleanupBlocked).toContain("open workspace");
    projects.pop();
    await mkdir(join(path, ".git"));
    expect((await inventory.scan()).entries[0]!.cleanupBlocked).toContain("Git checkout");
  },
);

it.skipIf(process.platform !== "linux")(
  "protects open workspaces reached through a symbolic-link alias",
  async () => {
    const { root, path, inventory, projects } = await fixture();
    const alias = join(root, "alias");
    await symlink(path, alias);
    projects.push({ id: randomUUID(), name: "alias", directory: alias, version: 1, tabs: [] });
    const candidate = (await inventory.scan()).entries.find((entry) => entry.path === path);
    expect(candidate?.cleanupBlocked).toContain("open workspace");
  },
);
it.skipIf(process.platform !== "linux")(
  "blocks ignored files, locked trees, and unique commits; removes only a clean pushed linked checkout",
  async () => {
    const { root, inventory, projects } = await fixture();
    const repo = join(root, "repo");
    await mkdir(repo);
    const git = (args: string[]) =>
      execute("git", [
        "-C",
        repo,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        ...args,
      ]);
    await git(["init", "-b", "main"]);
    await writeFile(join(repo, ".gitignore"), "ignored\n");
    await git(["add", "."]);
    await git(["commit", "-m", "fixture"]);
    await git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const tree = join(root, "linked");
    await git(["worktree", "add", "-b", "preview", tree]);
    projects.push({ id: randomUUID(), name: "repository", directory: repo, version: 1, tabs: [] });
    const find = async () => (await inventory.scan()).entries.find((item) => item.path === tree)!;
    await writeFile(join(tree, "ignored"), "preserve");
    expect((await find()).cleanupBlocked).toContain("ignored");
    await rm(join(tree, "ignored"));
    await git(["worktree", "lock", tree]);
    expect((await find()).cleanupBlocked).toContain("locked");
    await git(["worktree", "unlock", tree]);
    const clean = await find();
    expect(clean.cleanupBlocked).toBeNull();
    await execute("git", [
      "-C",
      tree,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "unique",
    ]);
    await expect(inventory.cleanup(clean.id, tree)).rejects.toThrow();
    expect((await find()).cleanupBlocked).toContain("commits");
    await git(["update-ref", "refs/remotes/origin/preview", "preview"]);
    const pushed = await find();
    expect(pushed.cleanupBlocked).toBeNull();
    await inventory.cleanup(pushed.id, tree);
    expect((await git(["branch", "--list", "preview"])).stdout).toContain("preview");
  },
  15_000,
);
