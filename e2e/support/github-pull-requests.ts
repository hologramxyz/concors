import type {
  PullRequest,
  PullRequestDetail,
  PullRequestTimelineEntry,
} from "../../packages/protocol/src/index.ts";
import type { GitHubSource } from "../../packages/daemon/src/projects/pull-requests.ts";

/**
 * Deterministic GitHub for acceptance tests, so no spec reaches api.github.com. Only repositories
 * named here have pull requests; any other GitHub repository lists none. Merges, closes and
 * comments change this daemon process's copy, as GitHub would.
 */
const pullRequest = (
  repository: string,
  number: number,
  overrides: Partial<PullRequest> = {},
): PullRequest => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/${repository}/pull/${number}`,
  author: "octocat",
  mine: false,
  draft: false,
  branch: `change-${number}`,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  review: null,
  checks: null,
  ...overrides,
});

export const fixturePullRequests: Record<string, PullRequest[]> = {
  "hologram/app": [
    pullRequest("hologram/app", 42, {
      title: "Show pull requests in workspaces",
      mine: true,
      author: "e2e-user",
      review: "approved",
      checks: "passing",
    }),
    pullRequest("hologram/app", 41, {
      title: "Draft: redesign onboarding",
      draft: true,
      checks: "pending",
    }),
  ],
  "hologram/site": [
    pullRequest("hologram/site", 7, {
      title: "Fix pricing table on mobile",
      review: "changes-requested",
      checks: "failing",
    }),
  ],
  "hologram/actions": [
    pullRequest("hologram/actions", 12, {
      title: "Merge me",
      review: "approved",
      checks: "passing",
    }),
    pullRequest("hologram/actions", 11, { title: "Close me" }),
  ],
};

const key = (repository: string, number: number) => `${repository}#${number}`;
const states = new Map<string, PullRequestDetail["state"]>();
const conversations = new Map<string, PullRequestTimelineEntry[]>();
const isOpen = (repository: string, number: number) =>
  (states.get(key(repository, number)) ?? "open") === "open";
const headSha = (number: number) => String(number).padStart(40, "0");

function detail(repository: string, item: PullRequest): PullRequestDetail {
  const timeline = conversations.get(key(repository, item.number)) ?? [];
  return {
    repository,
    number: item.number,
    title: item.title,
    url: item.url,
    body: `## Summary\n\n${item.title}, described for review.`,
    bodyTruncated: false,
    state: states.get(key(repository, item.number)) ?? "open",
    draft: item.draft,
    author: item.author,
    mine: item.mine,
    baseBranch: "main",
    headBranch: item.branch,
    headSha: headSha(item.number),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    commits: 2,
    additions: 48,
    deletions: 6,
    changedFiles: 3,
    review: item.review,
    mergeable: "mergeable",
    mergeState: item.draft
      ? "draft"
      : item.review === "changes-requested"
        ? "blocked"
        : item.checks === "failing"
          ? "unstable"
          : "clean",
    mergeMethods: ["squash", "merge", "rebase"],
    defaultMergeMethod: "squash",
    canMerge: true,
    canClose: true,
    checks: item.checks ? [{ name: "Unit tests", state: item.checks }] : [],
    checkCount: item.checks ? 1 : 0,
    labels: [{ name: "feature", color: "0e8a16" }],
    timeline,
    commentCount: timeline.length,
  };
}

const find = (id: string) => {
  const [repository = "", number = "0"] = id.replace(/^PR_/, "").split("#");
  return { repository, number: Number(number) };
};

export const fixtureGitHub: GitHubSource = {
  token: async () => "e2e-token",
  fetch: async (_token, repositories) => ({
    viewer: "e2e-user",
    repositories: repositories.map(({ owner, name }) => {
      const repository = `${owner}/${name}`;
      const pullRequests = (fixturePullRequests[repository] ?? []).filter((item) =>
        isOpen(repository, item.number),
      );
      return {
        name: repository,
        url: `https://github.com/${repository}`,
        openCount: pullRequests.length,
        pullRequests,
        error: null,
      };
    }),
  }),
  pullRequest: {
    detail: async (_token, { owner, name }, number) => {
      const repository = `${owner}/${name}`;
      const item = fixturePullRequests[repository]?.find((entry) => entry.number === number);
      if (!item)
        throw new Error(
          "This pull request was not found, or this machine's GitHub account cannot see it.",
        );
      return { id: `PR_${key(repository, number)}`, detail: detail(repository, item) };
    },
    merge: async (_token, id, _method, expectedHeadSha) => {
      const { repository, number } = find(id);
      if (expectedHeadSha !== headSha(number))
        throw new Error("Head branch was modified. Review and try the merge again.");
      states.set(key(repository, number), "merged");
    },
    close: async (_token, id) => {
      const { repository, number } = find(id);
      states.set(key(repository, number), "closed");
    },
    comment: async (_token, id, body) => {
      const { repository, number } = find(id);
      const timeline = conversations.get(key(repository, number)) ?? [];
      conversations.set(key(repository, number), [
        ...timeline,
        {
          id: `IC_${number}_${timeline.length}`,
          kind: "comment",
          author: "e2e-user",
          body,
          truncated: false,
          createdAt: new Date().toISOString(),
          review: null,
        },
      ]);
    },
  },
};
