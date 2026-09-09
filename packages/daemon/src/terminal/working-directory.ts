import { execFile } from "node:child_process";
import { readlink, realpath, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
/** Observe the shell itself, never an agent's subprocess or prompt text. */
export async function shellDirectory(pid: number): Promise<string | null> {
  try {
    if (process.platform === "linux") return await readlink(`/proc/${pid}/cwd`);
    if (process.platform === "darwin") {
      const { stdout } = await execute(
        "/usr/sbin/lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn0"],
        { timeout: 1500, maxBuffer: 16384 },
      );
      return (
        stdout
          .split(/\0|\n/)
          .find((field) => field.startsWith("n/"))
          ?.slice(1) ?? null
      );
    }
  } catch {
    /* Exited shells and restricted process inspection retain their last directory. */
  }
  return null;
}

/** OSC 7 fallback for shells that report a local directory (including on Windows). */
export function oscDirectory(data: string): string | null {
  try {
    if (data.length > 16384) return null;
    const url = new URL(data);
    if (
      url.protocol !== "file:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.hostname &&
        url.hostname !== "localhost" &&
        url.hostname.toLowerCase() !== hostname().toLowerCase())
    )
      return null;
    url.hostname = "";
    const path = fileURLToPath(url);
    // eslint-disable-next-line no-control-regex -- Reject control characters in terminal metadata.
    return isAbsolute(path) && path.length <= 4096 && !/[\x00-\x1f\x7f]/.test(path) ? path : null;
  } catch {
    return null;
  }
}

export async function directoryIdentity(
  input: string,
): Promise<{ directory: string; root: string }> {
  const directory = await realpath(input);
  if (directory.length > 4096 || !(await stat(directory)).isDirectory())
    throw new Error("Folder is unavailable");
  let root = directory;
  try {
    const { stdout } = await execute("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      timeout: 1500,
      maxBuffer: 16384,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
      },
    });
    const candidate = await realpath(stdout.trim());
    if (candidate.length <= 4096) root = candidate;
  } catch {
    /* Ordinary folders work without Git; linked worktrees retain their own checkout. */
  }
  return { directory, root };
}
