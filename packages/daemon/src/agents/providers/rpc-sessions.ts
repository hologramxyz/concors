import { open, readdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Read bounded native Pi/OMP headers; importing never sends a prompt. */
export async function rpcSessions(
  engine: "pi" | "omp",
  cwd: string,
  managed: string,
  env = process.env,
  limit = 100,
) {
  const base =
    env[engine === "pi" ? "PI_CODING_AGENT_DIR" : "OMP_AGENT_DIR"] ??
    join(homedir(), engine === "pi" ? ".pi" : ".omp", "agent");
  let root = env[engine === "pi" ? "PI_CODING_AGENT_SESSION_DIR" : "OMP_SESSION_DIR"];
  if (!root)
    for (const path of [
      join(base, "settings.json"),
      join(cwd, engine === "pi" ? ".pi" : ".omp", "settings.json"),
    ]) {
      try {
        const settings = JSON.parse(await readFile(path, "utf8")) as { sessionDir?: string };
        if (settings.sessionDir) root = settings.sessionDir;
      } catch {
        /* Optional native settings. */
      }
    }
  const expand = (path: string) =>
    resolve(cwd, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
  const files: { path: string; mtime: number }[] = [];
  const scan = async (dir: string, depth: number) => {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory() && depth > 0) await scan(path, depth - 1);
        else if (entry.isFile() && entry.name.endsWith(".jsonl"))
          files.push({ path, mtime: (await stat(path)).mtimeMs });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  await scan(expand(root ?? join(base, "sessions")), 2);
  await scan(managed, 0);
  const result: { id: string; title: string; directory: string; updatedAt: string }[] = [];
  for (const file of files.sort((a, b) => b.mtime - a.mtime)) {
    const handle = await open(file.path, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024),
        { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const rows = buffer
        .subarray(0, bytesRead)
        .toString()
        .split("\n")
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
      const header = rows.find((r) => r["type"] === "session");
      if (header?.["cwd"] !== cwd) continue;
      const first = rows
        .map((r) => r["message"] as { role?: string; content?: unknown } | undefined)
        .find((m) => m?.role === "user");
      const title =
        typeof first?.content === "string"
          ? first.content
          : Array.isArray(first?.content)
            ? first.content.map((p: { text?: string }) => p.text ?? "").join(" ")
            : "Agent session";
      result.push({
        id: file.path,
        title: title.slice(0, 150) || "Agent session",
        directory: cwd,
        updatedAt: new Date(file.mtime).toISOString(),
      });
      if (result.length >= limit) break;
    } finally {
      await handle.close();
    }
  }
  return result;
}
