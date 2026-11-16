import { lstat, opendir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { MAX_LOCATED_FILES } from "@concors/protocol";
import { projectPath } from "./paths.ts";

/** Generated and vendored trees: large, and never where an agent's own output is meant to be. */
const SKIPPED = new Set([".git", "node_modules", ".venv", "__pycache__"]);
/**
 * Build output and caches: large and growing all day, so searched after everything else rather
 * than not at all (an agent may well point at `dist/app.zip`). Ahead of them they would use up the
 * search before it reached the folders an agent writes into.
 */
const LAST = new Set([
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".gradle",
  ".pnpm-store",
  ".yarn",
  "vendor",
  "Pods",
  "DerivedData",
]);
const MAX_ENTRIES = 200_000;
const MAX_MS = 3000;

/**
 * Finds what a path from an agent's message refers to. An agent writes paths relative to wherever
 * it has moved to, which the app cannot see, so `clips/a.mp4` may really be `render/clips/a.mp4`.
 * A path that exists is the answer, without a search. Otherwise every file under the root ending in
 * that path is a candidate, newest first: what an agent just mentioned is usually what it just made.
 * Bounded by entries and time, so a huge folder gives fewer answers rather than a slow one. Links
 * are not followed, so nothing outside the root is reachable, the rule the file browser applies.
 */
export async function locateProjectFile(
  root: string,
  path: string,
  limits: { entries?: number; ms?: number } = {},
): Promise<string[]> {
  const candidate = projectPath(root, path);
  const missing = await lstat(candidate).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return true;
      throw error;
    },
  );
  const wanted = relative(root, candidate).split(sep).join("/");
  if (!missing) return [wanted];
  const suffix = `/${wanted}`;
  const deadline = Date.now() + (limits.ms ?? MAX_MS);
  let budget = limits.entries ?? MAX_ENTRIES;
  const found: { path: string; modified: number }[] = [];
  const last: string[] = [];
  /** Breadth first, so the limits cut off the deepest folders rather than whole branches of the top. */
  const search = async (start: readonly string[], deferring: boolean) => {
    const folders = [...start];
    // An array's iterator also visits what is added to it along the way.
    for (const folder of folders) {
      let entries;
      try {
        entries = await opendir(folder);
      } catch {
        continue; // One unreadable folder should not end the search.
      }
      for await (const entry of entries) {
        if (--budget < 0 || Date.now() > deadline) return false;
        const full = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (SKIPPED.has(entry.name)) continue;
          if (deferring && LAST.has(entry.name)) last.push(full);
          else folders.push(full);
        } else if (entry.isFile()) {
          const path = relative(root, full).split(sep).join("/");
          if (path.endsWith(suffix)) {
            const modified = await stat(full).then(
              (info) => info.mtimeMs,
              () => null,
            );
            if (modified !== null) found.push({ path, modified });
          }
        }
      }
    }
    return true;
  };
  // Build output and caches only once everything else has been searched.
  if (await search([root], true)) await search(last, false);
  return newestFirst(found);
}

function newestFirst(found: { path: string; modified: number }[]) {
  return found
    .sort((a, b) => b.modified - a.modified)
    .slice(0, MAX_LOCATED_FILES)
    .map((file) => file.path);
}
