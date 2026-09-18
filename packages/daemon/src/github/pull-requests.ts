import { z } from "zod";
import { MAX_PULL_REQUESTS_PER_REPOSITORY, type PullRequest } from "@concors/protocol";
import type { GitHubRepository } from "./remotes.ts";

/**
 * Open pull requests for a set of GitHub repositories, in as few GraphQL requests as possible.
 *
 * Each repository reports its exact open count plus its most recently updated pull requests.
 * A repository the account cannot see fails on its own; a rejected token or a rate limit fails
 * the whole lookup, because every repository would fail the same way.
 */
export interface RepositoryPullRequests {
  readonly name: string;
  readonly url: string;
  readonly openCount: number;
  readonly pullRequests: PullRequest[];
  readonly error: string | null;
}
export interface PullRequestListing {
  readonly viewer: string | null;
  readonly repositories: RepositoryPullRequests[];
}
export class GitHubAuthError extends Error {}

const ENDPOINT = "https://api.github.com/graphql";
const BATCH_SIZE = 30;

export function pullRequestsQuery(repositories: readonly GitHubRepository[]) {
  const variables: Record<string, string> = {};
  const parameters: string[] = [];
  const fields = repositories.map((repository, index) => {
    variables[`o${index}`] = repository.owner;
    variables[`n${index}`] = repository.name;
    parameters.push(`$o${index}: String!`, `$n${index}: String!`);
    return `r${index}: repository(owner: $o${index}, name: $n${index}) { ...OpenPullRequests }`;
  });
  const query = `query(${parameters.join(", ")}) { viewer { login } ${fields.join(" ")} }
fragment OpenPullRequests on Repository {
  nameWithOwner url
  pullRequests(states: OPEN, first: ${MAX_PULL_REQUESTS_PER_REPOSITORY}, orderBy: {field: UPDATED_AT, direction: DESC}) {
    totalCount
    nodes {
      number title url isDraft createdAt updatedAt headRefName reviewDecision viewerDidAuthor
      author { login }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;
  return { query, variables };
}

const PullRequestNode = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  headRefName: z.string(),
  reviewDecision: z.string().nullish(),
  viewerDidAuthor: z.boolean(),
  author: z.object({ login: z.string() }).nullish(),
  commits: z
    .object({
      nodes: z
        .array(
          z
            .object({
              commit: z.object({
                statusCheckRollup: z.object({ state: z.string() }).nullish(),
              }),
            })
            .nullish(),
        )
        .nullish(),
    })
    .nullish(),
});
const RepositoryNode = z.object({
  nameWithOwner: z.string(),
  url: z.string(),
  pullRequests: z.object({
    totalCount: z.number().int().nonnegative(),
    nodes: z.array(PullRequestNode.nullish()).nullish(),
  }),
});
const Response = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z
    .array(
      z.object({
        type: z.string().optional(),
        message: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
});

const reviews: Record<string, PullRequest["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
};
const checks: Record<string, PullRequest["checks"]> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};
const isGitHubUrl = (url: string) => url.startsWith("https://github.com/");
const clip = (text: string, length: number) =>
  text.length > length ? text.slice(0, length) : text;

function readPullRequest(node: z.infer<typeof PullRequestNode>): PullRequest | null {
  if (!isGitHubUrl(node.url)) return null;
  const state = node.commits?.nodes?.at(-1)?.commit.statusCheckRollup?.state;
  return {
    number: node.number,
    title: clip(node.title, 1024),
    url: clip(node.url, 2048),
    author: node.author ? clip(node.author.login, 100) : null,
    mine: node.viewerDidAuthor,
    draft: node.isDraft,
    branch: clip(node.headRefName, 255),
    createdAt: clip(node.createdAt, 40),
    updatedAt: clip(node.updatedAt, 40),
    review: reviews[node.reviewDecision ?? ""] ?? null,
    checks: checks[state ?? ""] ?? null,
  };
}

/** Maps one GraphQL response onto the requested repositories, in request order. */
export function readPullRequests(
  repositories: readonly GitHubRepository[],
  body: unknown,
): PullRequestListing {
  const response = Response.parse(body);
  if (!response.data) throw new Error(clip(response.errors?.[0]?.message ?? "GitHub error", 500));
  const viewer = z.object({ login: z.string() }).safeParse(response.data.viewer);
  return {
    viewer: viewer.success ? clip(viewer.data.login, 100) : null,
    repositories: repositories.map((repository, index) => {
      const fallback = {
        name: `${repository.owner}/${repository.name}`,
        url: `https://github.com/${repository.owner}/${repository.name}`,
        openCount: 0,
        pullRequests: [],
      };
      const node = RepositoryNode.safeParse(response.data?.[`r${index}`]);
      if (!node.success) {
        const error = response.errors?.find((item) => item.path?.[0] === `r${index}`);
        return {
          ...fallback,
          error:
            !error || error.type === "NOT_FOUND"
              ? "Not found, or this machine's GitHub account cannot see it."
              : clip(error.message ?? "GitHub could not list this repository.", 500),
        };
      }
      return {
        name: clip(node.data.nameWithOwner, 200),
        url: isGitHubUrl(node.data.url) ? clip(node.data.url, 2048) : fallback.url,
        openCount: node.data.pullRequests.totalCount,
        pullRequests: (node.data.pullRequests.nodes ?? [])
          .flatMap((item) => (item ? [readPullRequest(item)] : []))
          .filter((item): item is PullRequest => !!item)
          .slice(0, MAX_PULL_REQUESTS_PER_REPOSITORY),
        error: null,
      };
    }),
  };
}

export async function fetchPullRequests(
  token: string,
  repositories: readonly GitHubRepository[],
  request: typeof fetch = fetch,
): Promise<PullRequestListing> {
  let viewer: string | null = null;
  const results: RepositoryPullRequests[] = [];
  for (let start = 0; start < repositories.length; start += BATCH_SIZE) {
    const batch = repositories.slice(start, start + BATCH_SIZE);
    const response = await request(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "Concors",
      },
      body: JSON.stringify(pullRequestsQuery(batch)),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401)
      throw new GitHubAuthError("GitHub rejected this machine's credentials.");
    if (response.status === 403 || response.status === 429)
      throw new Error("GitHub's rate limit was reached. Pull requests will refresh shortly.");
    if (!response.ok) throw new Error(`GitHub is unavailable (HTTP ${response.status}).`);
    const listing = readPullRequests(batch, await response.json());
    viewer ??= listing.viewer;
    results.push(...listing.repositories);
  }
  return { viewer, repositories: results };
}
