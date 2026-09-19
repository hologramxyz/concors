import type { PullRequest, PullRequestRepository } from "@concors/protocol";

export const pullRequestsLabel = (count: number) =>
  `${count} open pull request${count === 1 ? "" : "s"}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact, GitHub-style ages: "just now", "5m ago", "3h ago", "4d ago", then the date. */
export function ageLabel(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  const date = new Date(time);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

export const reviewLabel: Record<NonNullable<PullRequest["review"]>, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
};

export const checksLabel: Record<NonNullable<PullRequest["checks"]>, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks running",
};

/** A repository's name without its owner, unless another listed repository shares that name. */
export function repositoryLabel(name: string, names: readonly string[]): string {
  const short = (full: string) => full.slice(full.indexOf("/") + 1).toLowerCase();
  const own = short(name);
  return names.some((other) => other !== name && short(other) === own)
    ? name
    : name.slice(name.indexOf("/") + 1);
}

/** Repositories with the most open pull requests first, then by name. */
export function byOpenCount<T extends Pick<PullRequestRepository, "name" | "openCount">>(
  repositories: readonly T[],
): T[] {
  return [...repositories].sort(
    (a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name),
  );
}

/**
 * Which child folders hold a repository. Nothing when the workspace is the repository itself, or
 * when its one folder is simply named after it.
 */
export function foldersLabel(
  repository: Pick<PullRequestRepository, "folders" | "name">,
): string | null {
  const folders = repository.folders.filter(Boolean);
  const name = repository.name.slice(repository.name.indexOf("/") + 1).toLowerCase();
  if (!folders.length || (folders.length === 1 && folders[0]?.toLowerCase() === name)) return null;
  if (folders.length <= 2) return folders.join(", ");
  return `${folders.slice(0, 2).join(", ")} +${folders.length - 2}`;
}
