import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function projectPath(root: string, path: string): string {
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.startsWith("\\") ||
    path.split(/[\\/]/).includes("..")
  )
    throw new Error("Choose a file inside this project.");
  const candidate = resolve(root, path.replaceAll("\\", "/"));
  const rel = relative(root, candidate);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error("Choose a file inside this project.");
  return candidate;
}

export async function resolveProjectPath(root: string, path: string): Promise<string> {
  const candidate = projectPath(root, path);
  const rel = relative(root, candidate);
  let cursor = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Symbolic links cannot be opened in the file browser.");
  }
  const canonical = await realpath(candidate);
  const resolvedRelative = relative(root, canonical);
  if (
    resolvedRelative.startsWith(`..${sep}`) ||
    resolvedRelative === ".." ||
    isAbsolute(resolvedRelative)
  )
    throw new Error("Choose a file inside this project.");
  return candidate;
}
