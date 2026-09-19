import { execFile } from "node:child_process";
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_SCANNED_CHILDREN = 256;
export const MAX_CHILD_REPOSITORIES = 32;

/** Git reads the selected directory, not a repository inherited from the daemon's environment. */
export function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_INDEX_FILE;
  return env;
}

export async function git(directory: string, args: string[], maxBuffer = 4096): Promise<string> {
  const { stdout } = await exec("git", ["-C", directory, ...args], {
    timeout: 1500,
    maxBuffer,
    windowsHide: true,
    env: gitEnvironment(),
  });
  return stdout;
}

/** The work tree containing `directory`, or null for ordinary folders and bare repositories. */
export async function workTreeRoot(directory: string): Promise<string | null> {
  try {
    if ((await git(directory, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true")
      return null;
    return (await git(directory, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Direct children of a folder that are repository roots (a `.git` directory, or a worktree's
 * `.git` file), sorted by name. One level only: a folder of folders of repositories has none.
 * Linked children are skipped so discovery stays inside the selected folder.
 */
export async function childRepositories(directory: string): Promise<string[]> {
  const children: string[] = [];
  let scanned = 0;
  try {
    for await (const child of await opendir(directory)) {
      if (++scanned > MAX_SCANNED_CHILDREN) break;
      if (child.isDirectory() && !child.name.startsWith(".")) children.push(child.name);
    }
  } catch {
    return [];
  }
  const repositories: string[] = [];
  for (const name of children.sort()) {
    if (repositories.length === MAX_CHILD_REPOSITORIES) break;
    try {
      const marker = await lstat(join(directory, name, ".git"));
      if (marker.isDirectory() || marker.isFile()) repositories.push(name);
    } catch {
      /* Not a repository root. */
    }
  }
  return repositories;
}
