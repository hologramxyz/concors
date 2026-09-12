import type { ApiClient } from "@concors/api-client";

/** Recognize GitHub's HTTPS and SSH clone formats without rewriting other Git hosts. */
export function githubRepository(input: string): string | null {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      input.trim(),
    );
  const name = match?.[1];
  const repo = name?.split("/")[1];
  if (!name || !repo || [".", ".."].includes(repo)) return null;
  return name;
}

export async function prepareClone(
  api: Pick<ApiClient, "githubStatus" | "prepareGitHubMachine">,
  machineId: string,
  repository: string,
): Promise<string> {
  const name = githubRepository(repository);
  if (machineId === "local" || !name) return repository.trim();
  const status = await api.githubStatus();
  if (!status.connected) return repository.trim();
  await api.prepareGitHubMachine(machineId, name);
  return `https://github.com/${name}.git`;
}
