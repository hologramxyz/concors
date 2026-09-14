import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, previewProcesses, requireCleanMain, updateMain } from "./reload-support";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "concors-reload-"));
  directories.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Reload test");
  git(root, "config", "user.email", "reload@example.test");
  git(root, "commit", "--allow-empty", "-m", "Initial");
  return root;
}

it("refuses dirty worktrees and feature branches without discarding changes", () => {
  const root = repository();
  writeFileSync(join(root, "notes.txt"), "keep this");
  expect(() => requireCleanMain(root)).toThrow("Commit or stash");
  expect(git(root, "status", "--porcelain")).toContain("notes.txt");
  git(root, "add", ".");
  git(root, "commit", "-m", "Notes");
  git(root, "switch", "-c", "feature");
  expect(() => requireCleanMain(root)).toThrow("Switch this checkout to main");
  expect(git(root, "branch", "--show-current")).toBe("feature");
});

it("fast-forwards main but refuses unpublished commits", () => {
  const remote = repository();
  const parent = mkdtempSync(join(tmpdir(), "concors-reload-clone-"));
  directories.push(parent);
  const clone = join(parent, "client");
  execFileSync("git", ["clone", remote, clone], { stdio: "pipe" });
  git(clone, "config", "user.name", "Reload test");
  git(clone, "config", "user.email", "reload@example.test");
  git(remote, "commit", "--allow-empty", "-m", "Merged change");
  updateMain(clone);
  expect(git(clone, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "HEAD"));
  git(clone, "commit", "--allow-empty", "-m", "Unpublished");
  const localHead = git(clone, "rev-parse", "HEAD");
  expect(() => updateMain(clone)).toThrow("unpublished commits");
  expect(git(clone, "rev-parse", "HEAD")).toBe(localHead);
});

it("only targets the checkout's app and bundled gateway, leaving session hosts and other Node processes alone", () => {
  const target = "/tmp/repo with spaces/target";
  const app = { pid: 10, executable: target + "/debug/concors-desktop", args: [] };
  const gateway = {
    pid: 11,
    executable: target + "/debug/daemon/bin/node",
    args: ["node", target + "/debug/daemon/bin/../lib/cli.js", "serve"],
  };
  const host = { ...gateway, pid: 12, args: ["node", target + "/debug/daemon/lib/cli.js", "host"] };
  const unrelated = {
    pid: 13,
    executable: "/usr/bin/node",
    args: ["node", "/other/server.js", "serve"],
  };
  const wrongScript = { ...gateway, pid: 14, args: ["node", "/other/server.js", "serve"] };
  expect(previewProcesses([app, gateway, host, unrelated, wrongScript], [target])).toEqual({
    apps: [app],
    gateways: [gateway],
  });
});

it("refuses to stop another installed Concors application", () => {
  expect(() =>
    previewProcesses(
      [{ pid: 1, executable: "/usr/bin/concors-desktop", args: [] }],
      ["/tmp/target"],
    ),
  ).toThrow("Close the other Concors installation first");
});

it("refuses to run inside a Concors terminal before stopping its own session host", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./reload.ts", import.meta.url))],
    {
      env: { ...process.env, TERM_PROGRAM: "concors" },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("external terminal");
});
