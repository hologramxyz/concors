import { useContext } from "react";
import { ProjectRootsContext } from "@/files/context";
import { tildePath, useHomePath } from "@/workspace/home-path";

/**
 * A path as a step row shows it: relative to the workspace it is in (the deepest, when one holds
 * another), else with "~" for home. Display only: the full path stays in the row's tooltip, and
 * what opens a file still gets the path as the agent wrote it.
 */
export function shortPath(path: string, roots: readonly string[], home: string | null): string {
  let best = "";
  for (const raw of roots) {
    const root = raw.replace(/[\\/]+$/, "");
    const separator = path[root.length];
    if (
      root &&
      root.length > best.length &&
      path.startsWith(root) &&
      (separator === "/" || separator === "\\")
    )
      best = root;
  }
  return best ? path.slice(best.length + 1) : tildePath(path, home);
}

/** `shortPath` for the chat's own workspaces and machine. */
export function useShortPath(): (path: string) => string {
  const roots = useContext(ProjectRootsContext);
  const home = useHomePath();
  return (path) => {
    const relative = shortPath(path, roots, null);
    return relative === path ? home(path) : relative;
  };
}
