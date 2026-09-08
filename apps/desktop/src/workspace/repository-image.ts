/** Only GitHub clone URLs are eligible; never send arbitrary URLs or credentials to an image host. */
export function repositoryImage(repository: string): string | null {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z0-9][a-z0-9-]*)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      repository.trim(),
    );
  const owner = match?.[1],
    repo = match?.[2];
  if (!owner || !repo || repo === "." || repo === "..") return null;
  return `https://opengraph.githubassets.com/1/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
