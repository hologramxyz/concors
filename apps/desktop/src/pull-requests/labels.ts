import type {
  MergeMethod,
  PullRequest,
  PullRequestDetail,
  PullRequestRepository,
} from "@concors/protocol";

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

export const mergeMethodLabel: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

export interface MergeReadiness {
  readonly tone: "ready" | "pending" | "warning" | "blocked";
  readonly title: string;
  readonly description: string;
  /** False only when GitHub would certainly refuse; otherwise GitHub has the final say. */
  readonly allowed: boolean;
}

/** What stands between an open pull request and a merge, in the order people fix them. */
export function mergeReadiness(detail: PullRequestDetail): MergeReadiness {
  const base = detail.baseBranch;
  const failing = detail.checks.some((check) => check.state === "failing");
  const pending = detail.checks.some((check) => check.state === "pending");
  if (!detail.canMerge)
    return {
      tone: "blocked",
      title: "You can't merge this pull request",
      description: `This machine's GitHub account needs write access to ${detail.repository}.`,
      allowed: false,
    };
  if (detail.draft || detail.mergeState === "draft")
    return {
      tone: "blocked",
      title: "This pull request is still a draft",
      description: "Drafts can't be merged until they are marked ready for review.",
      allowed: false,
    };
  if (detail.mergeable === "conflicting" || detail.mergeState === "dirty")
    return {
      tone: "blocked",
      title: "This branch has conflicts",
      description: `Resolve the conflicts with ${base} before merging.`,
      allowed: false,
    };
  if (detail.mergeable === "unknown" || detail.mergeState === "unknown")
    return {
      tone: "pending",
      title: "Checking whether this can be merged…",
      description: "GitHub is still working out mergeability.",
      allowed: true,
    };
  if (detail.mergeState === "behind")
    return {
      tone: "warning",
      title: `This branch is out of date with ${base}`,
      description: "The repository requires it to be up to date before merging.",
      allowed: true,
    };
  if (detail.mergeState === "blocked")
    return {
      tone: "warning",
      title:
        detail.review === "changes-requested"
          ? "Changes were requested"
          : detail.review === "review-required"
            ? "Review required"
            : failing
              ? "Required checks are failing"
              : pending
                ? "Required checks are still running"
                : "Merging is blocked",
      description: "Branch protection must be satisfied first; administrators may merge anyway.",
      allowed: true,
    };
  if (detail.mergeState === "unstable" || failing)
    return {
      tone: "warning",
      title: failing ? "Some checks are failing" : "Some checks are still running",
      description: "They are not required, so this can still be merged.",
      allowed: true,
    };
  return {
    tone: "ready",
    title: "Ready to merge",
    description: pending
      ? "Some optional checks are still running."
      : detail.checks.length
        ? "All checks have passed."
        : `No conflicts with ${base}.`,
    allowed: true,
  };
}

/**
 * What an open row offers: nothing from a daemon that cannot act on pull requests; otherwise
 * Merge for write access (disabled for drafts) and Close for write, triage or the author. When an
 * older daemon does not report access, GitHub decides.
 */
export function rowActions({
  supported,
  permission,
  draft,
  mine,
}: {
  supported: boolean;
  permission: PullRequestRepository["permission"];
  draft: boolean;
  mine: boolean;
}): { merge: "enabled" | "draft" | null; close: boolean } | null {
  if (!supported) return null;
  const canMerge = !permission || ["admin", "maintain", "write"].includes(permission);
  const canClose = canMerge || permission === "triage" || mine;
  if (!canMerge && !canClose) return null;
  return { merge: canMerge ? (draft ? "draft" : "enabled") : null, close: canClose };
}
