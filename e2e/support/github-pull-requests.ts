import type { PullRequest } from "../../packages/protocol/src/index.ts";
import type { GitHubSource } from "../../packages/daemon/src/projects/pull-requests.ts";

/**
 * Deterministic pull requests for acceptance tests, so no spec reaches api.github.com. Only
 * repositories named here have pull requests; any other GitHub repository lists none.
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
};

export const fixtureGitHub: GitHubSource = {
  token: async () => "e2e-token",
  fetch: async (_token, repositories) => ({
    viewer: "e2e-user",
    repositories: repositories.map(({ owner, name }) => {
      const pullRequests = fixturePullRequests[`${owner}/${name}`] ?? [];
      return {
        name: `${owner}/${name}`,
        url: `https://github.com/${owner}/${name}`,
        openCount: pullRequests.length,
        pullRequests,
        error: null,
      };
    }),
  }),
};
