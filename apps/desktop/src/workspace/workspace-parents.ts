import type { WorkspaceProject } from "@concors/protocol";

/**
 * The parent folder of each workspace that shares its name with one in another folder, so
 * `studio` in ~/work and `studio` in ~/old can be told apart.
 */
export function clashingWorkspaceParents(projects: readonly WorkspaceProject[]) {
  const parents = new Map<string, string>();
  for (const project of projects) {
    const name = project.name.toLowerCase();
    if (
      projects.some(
        (other) => other.name.toLowerCase() === name && other.directory !== project.directory,
      )
    )
      parents.set(project.id, project.directory.split(/[\\/]/).filter(Boolean).at(-2) ?? "/");
  }
  return parents;
}
