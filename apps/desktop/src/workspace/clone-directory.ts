function folderSegment(value: string) {
  const segment = value
    .replace(/\.git$/i, "")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .slice(0, 100);
  return segment === "." || segment === ".." ? "" : segment;
}

function githubRepositoryParts(repository: string) {
  const shorthand = repository.match(/^([^/:\\]+)\/([^/\\]+)$/);
  if (shorthand) return shorthand.slice(1);

  const scp = repository.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (scp) return scp.slice(1);

  try {
    const url = new URL(repository);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 2 ? parts : null;
  } catch {
    return null;
  }
}

export function defaultCloneDirectory(repository: string) {
  const value = repository.trim().replace(/\/$/, "");
  if (!value) return "";

  const githubParts = githubRepositoryParts(value)
    ?.map(folderSegment)
    .filter((part) => part.length > 0);
  if (githubParts?.length === 2) return `~/repos/${githubParts.join("/")}`;

  const folder = folderSegment(value.split(/[/:\\]/).at(-1) ?? "");
  return folder ? `~/repos/${folder}` : "";
}
