import { git } from "../projects/repositories.ts";

/**
 * Which GitHub repository a local checkout belongs to, read from its remotes.
 *
 * Only github.com is recognized; Enterprise hosts and SSH host aliases are left alone rather than
 * guessed. A fork usually has its pull requests on the repository it was forked from, so remotes
 * are chosen the way the GitHub CLI chooses them: an explicit `gh repo set-default` first, then
 * `upstream`, `github`, `origin`, then any other remote by name.
 */
export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
}

export const repositoryKey = (repository: GitHubRepository) =>
  `${repository.owner}/${repository.name}`.toLowerCase();

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function parseGitHubRemote(url: string): GitHubRepository | null {
  let path: string;
  const scp = /^(?:[^@/\s]+@)?(?:www\.)?github\.com:(?!\d+\/)(.+)$/i.exec(url.trim());
  if (scp) path = scp[1] ?? "";
  else {
    try {
      const parsed = new URL(url.trim());
      if (
        !["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(parsed.protocol) ||
        !/^(?:www\.)?github\.com$/i.test(parsed.hostname)
      )
        return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  const [owner, rawName, ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
  const name = rawName?.replace(/\.git$/i, "");
  if (rest.length || !owner || !name || !OWNER.test(owner) || !NAME.test(name)) return null;
  if (name === "." || name === "..") return null;
  return { owner, name };
}

const PRIORITY = ["upstream", "github", "origin"];

/** Picks from `git config --get-regexp` output for `remote.<name>.(url|gh-resolved)`. */
export function preferredGitHubRemote(config: string): GitHubRepository | null {
  const remotes = new Map<string, { url?: string; base?: boolean }>();
  for (const line of config.split("\n")) {
    const match = /^remote\.(.+)\.(url|gh-resolved) (.*)$/.exec(line.trim());
    if (!match) continue;
    const [, remote = "", key, value = ""] = match;
    const entry = remotes.get(remote) ?? {};
    if (key === "url") entry.url ??= value;
    else if (value === "base") entry.base = true;
    remotes.set(remote, entry);
  }
  const rank = (name: string) => {
    const index = PRIORITY.indexOf(name);
    return index === -1 ? PRIORITY.length : index;
  };
  const ordered = [...remotes]
    .map(([name, entry]) => ({ name, ...entry, repository: parseGitHubRemote(entry.url ?? "") }))
    .filter((entry) => entry.repository)
    .sort(
      (a, b) =>
        Number(!!b.base) - Number(!!a.base) ||
        rank(a.name) - rank(b.name) ||
        a.name.localeCompare(b.name),
    );
  return ordered[0]?.repository ?? null;
}

export async function gitHubRepository(checkout: string): Promise<GitHubRepository | null> {
  try {
    return preferredGitHubRemote(
      await git(checkout, ["config", "--get-regexp", "^remote\\..*\\.(url|gh-resolved)$"], 65536),
    );
  } catch {
    // Exit status 1 means no remotes; any other failure also leaves the checkout unmatched.
    return null;
  }
}
