import { expect, it, vi } from "vitest";
import { MAX_PULL_REQUESTS_PER_REPOSITORY } from "@concors/protocol";
import {
  fetchPullRequests,
  GitHubAuthError,
  pullRequestsQuery,
  readPullRequests,
} from "./pull-requests.ts";

const concors = { owner: "concors-dev", name: "concors" };
const secret = { owner: "concors-dev", name: "secret" };
const node = (number: number, overrides: Record<string, unknown> = {}) => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/concors-dev/concors/pull/${number}`,
  isDraft: false,
  createdAt: "2026-09-18T10:00:00Z",
  updatedAt: "2026-09-18T11:00:00Z",
  headRefName: `feat/${number}`,
  reviewDecision: "APPROVED",
  viewerDidAuthor: true,
  author: { login: "octocat" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
  ...overrides,
});
const repository = (nodes: unknown[], totalCount = nodes.length) => ({
  nameWithOwner: "concors-dev/concors",
  url: "https://github.com/concors-dev/concors",
  pullRequests: { totalCount, nodes },
});

it("passes owners and names as variables rather than query text", () => {
  const { query, variables } = pullRequestsQuery([concors, { owner: "a", name: 'b") {' }]);
  expect(variables).toEqual({ o0: "concors-dev", n0: "concors", o1: "a", n1: 'b") {' });
  expect(query).not.toContain("concors-dev");
  expect(query).toContain("r1: repository(owner: $o1, name: $n1)");
});

it("maps pull requests, reviews and checks, keeping the exact open count", () => {
  const listing = readPullRequests([concors], {
    data: {
      viewer: { login: "octocat" },
      r0: repository(
        [
          node(2),
          node(1, {
            isDraft: true,
            viewerDidAuthor: false,
            author: null,
            reviewDecision: null,
            commits: { nodes: [] },
          }),
          node(3, { url: "https://evil.example/pull/3" }),
        ],
        40,
      ),
    },
  });
  expect(listing.viewer).toBe("octocat");
  expect(listing.repositories).toEqual([
    {
      name: "concors-dev/concors",
      url: "https://github.com/concors-dev/concors",
      openCount: 40,
      error: null,
      pullRequests: [
        {
          number: 2,
          title: "Change 2",
          url: "https://github.com/concors-dev/concors/pull/2",
          author: "octocat",
          mine: true,
          draft: false,
          branch: "feat/2",
          createdAt: "2026-09-18T10:00:00Z",
          updatedAt: "2026-09-18T11:00:00Z",
          review: "approved",
          checks: "failing",
        },
        expect.objectContaining({
          number: 1,
          author: null,
          mine: false,
          draft: true,
          review: null,
          checks: null,
        }),
      ],
    },
  ]);
});

it("reports an inaccessible repository on its own", () => {
  const listing = readPullRequests([secret, concors], {
    data: { viewer: { login: "octocat" }, r0: null, r1: repository([node(1)]) },
    errors: [{ type: "NOT_FOUND", path: ["r0"], message: "Could not resolve" }],
  });
  expect(listing.repositories[0]).toEqual({
    name: "concors-dev/secret",
    url: "https://github.com/concors-dev/secret",
    openCount: 0,
    pullRequests: [],
    error: "Not found, or this machine's GitHub account cannot see it.",
  });
  expect(listing.repositories[1]?.openCount).toBe(1);
});

it("fails the whole lookup when GitHub returns no data", () => {
  expect(() =>
    readPullRequests([concors], { errors: [{ type: "RATE_LIMITED", message: "Slow down" }] }),
  ).toThrow("Slow down");
});

it("batches large sets and bounds each repository's listing", async () => {
  const repositories = Array.from({ length: 31 }, (_, index) => ({
    owner: "concors-dev",
    name: `repo-${index}`,
  }));
  const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
    const data: Record<string, unknown> = { viewer: { login: "octocat" } };
    for (let index = 0; index < Object.keys(variables).length / 2; index++)
      data[`r${index}`] = repository(
        Array.from({ length: MAX_PULL_REQUESTS_PER_REPOSITORY + 5 }, (_, n) => node(n + 1)),
        99,
      );
    return Response.json({ data });
  });
  const listing = await fetchPullRequests("token", repositories, request);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "bearer token" });
  expect(listing.repositories).toHaveLength(31);
  expect(listing.repositories[30]?.pullRequests).toHaveLength(MAX_PULL_REQUESTS_PER_REPOSITORY);
});

it("distinguishes rejected credentials from rate limits and outages", async () => {
  const status = (code: number) => async () => new Response("{}", { status: code });
  await expect(fetchPullRequests("token", [concors], status(401))).rejects.toBeInstanceOf(
    GitHubAuthError,
  );
  await expect(fetchPullRequests("token", [concors], status(403))).rejects.toThrow("rate limit");
  await expect(fetchPullRequests("token", [concors], status(502))).rejects.toThrow("HTTP 502");
});
