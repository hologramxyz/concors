import type { PullRequest, PullRequestRepository } from "@concors/protocol";

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

/** Which child folders hold a repository; nothing when the workspace is the repository itself. */
export function foldersLabel(repository: Pick<PullRequestRepository, "folders">): string | null {
  const folders = repository.folders.filter(Boolean);
  if (!folders.length) return null;
  if (folders.length <= 2) return folders.join(", ");
  return `${folders.slice(0, 2).join(", ")} +${folders.length - 2}`;
}
