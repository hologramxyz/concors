import { expect, it } from "vitest";
import { parseClientMessage, parseDaemonMessage } from "./messages.ts";
import { MAX_PULL_REQUESTS_PER_REPOSITORY, PullRequestResultSchema } from "./pull-requests.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const pullRequest = {
  number: 7,
  title: "Add workspace pull requests",
  url: "https://github.com/concors-dev/concors/pull/7",
  author: "octocat",
  mine: true,
  draft: false,
  branch: "feat/workspace-pull-requests",
  createdAt: "2026-09-18T10:00:00Z",
  updatedAt: "2026-09-18T11:00:00Z",
  review: "review-required",
  checks: "passing",
};
const listed = (pullRequests: unknown[], url = "https://github.com/concors-dev/concors") => ({
  type: "pull-request.result",
  requestId,
  outcome: {
    status: "listed",
    viewer: "octocat",
    fetchedAt: 1,
    workspaces: [
      {
        projectId,
        directory: "/home/me/concors",
        repositories: [
          {
            name: "concors-dev/concors",
            url,
            folders: [""],
            openCount: pullRequests.length,
            pullRequests,
            error: null,
          },
        ],
      },
    ],
  },
});

it("round-trips pull request listings through the message envelopes", () => {
  expect(
    parseClientMessage({
      type: "pull-request.request",
      requestId,
      operation: { kind: "list", epoch: requestId, projects: [{ projectId }], refresh: true },
    }).success,
  ).toBe(true);
  expect(parseDaemonMessage(listed([pullRequest])).success).toBe(true);
  expect(
    parseDaemonMessage({
      type: "pull-request.result",
      requestId,
      outcome: { status: "signed-out", message: "Sign in to GitHub on this machine." },
    }).success,
  ).toBe(true);
});

it("only links to GitHub and bounds each repository's listing", () => {
  expect(
    PullRequestResultSchema.safeParse(listed([pullRequest], "javascript:alert(1)")).success,
  ).toBe(false);
  expect(
    PullRequestResultSchema.safeParse(
      listed([{ ...pullRequest, url: "https://example.com/concors/pull/7" }]),
    ).success,
  ).toBe(false);
  expect(
    PullRequestResultSchema.safeParse(
      listed(Array.from({ length: MAX_PULL_REQUESTS_PER_REPOSITORY + 1 }, () => pullRequest)),
    ).success,
  ).toBe(false);
});

const detail = {
  repository: "concors-dev/concors",
  number: 7,
  title: "Add workspace pull requests",
  url: "https://github.com/concors-dev/concors/pull/7",
  body: "Adds counts.",
  bodyTruncated: false,
  state: "open",
  draft: false,
  author: "octocat",
  mine: true,
  baseBranch: "main",
  headBranch: "feat/workspace-pull-requests",
  headSha: "a".repeat(40),
  createdAt: "2026-09-18T10:00:00Z",
  updatedAt: "2026-09-18T11:00:00Z",
  commits: 3,
  additions: 120,
  deletions: 4,
  changedFiles: 9,
  review: "approved",
  mergeable: "mergeable",
  mergeState: "clean",
  mergeMethods: ["squash", "merge"],
  defaultMergeMethod: "squash",
  canMerge: true,
  canClose: true,
  checks: [{ name: "test", state: "passing" }],
  checkCount: 1,
  labels: [{ name: "feature", color: "0e8a16" }],
  timeline: [
    {
      id: "c1",
      kind: "review",
      author: "hubot",
      body: "",
      truncated: false,
      createdAt: "2026-09-18T10:30:00Z",
      review: "approved",
    },
  ],
  commentCount: 0,
};
const target = { epoch: requestId, projectId, repository: "concors-dev/concors", number: 7 };

it("carries pull request details and the result of an action", () => {
  for (const outcome of [
    { status: "detail", detail },
    { status: "updated", action: "merged", detail: { ...detail, state: "merged" } },
  ])
    expect(parseDaemonMessage({ type: "pull-request.result", requestId, outcome }).success).toBe(
      true,
    );
});

it("validates merge, close and comment requests before they reach GitHub", () => {
  const valid = (operation: Record<string, unknown>) =>
    parseClientMessage({ type: "pull-request.request", requestId, operation }).success;
  expect(valid({ kind: "detail", ...target })).toBe(true);
  expect(
    valid({ kind: "merge", ...target, method: "squash", expectedHeadSha: "b".repeat(40) }),
  ).toBe(true);
  expect(valid({ kind: "merge", ...target, method: "squash" })).toBe(false);
  expect(
    valid({ kind: "merge", ...target, method: "fast-forward", expectedHeadSha: "b".repeat(40) }),
  ).toBe(false);
  expect(valid({ kind: "close", ...target })).toBe(true);
  expect(valid({ kind: "close", ...target, comment: "Superseded by #8." })).toBe(true);
  expect(valid({ kind: "comment", ...target, body: "   " })).toBe(false);
  expect(valid({ kind: "comment", ...target, body: "x".repeat(65_537) })).toBe(false);
  for (const repository of ["concors", "a/b/c", "../etc", "owner/na me"])
    expect(valid({ kind: "detail", ...target, repository })).toBe(false);
});
