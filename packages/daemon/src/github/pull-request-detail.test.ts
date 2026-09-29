import { expect, it } from "vitest";
import { MAX_PULL_REQUEST_TEXT, PullRequestDetailSchema } from "@concors/protocol";
import { readPullRequestDetail } from "./pull-request-detail.ts";

const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  id: "PR_node",
  number: 7,
  title: "Add workspace pull requests",
  url: "https://github.com/hologramxyz/concors/pull/7",
  body: "<!-- Describe your change -->\nAdds counts to the sidebar.",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "BLOCKED",
  createdAt: "2026-09-18T10:00:00Z",
  updatedAt: "2026-09-18T11:00:00Z",
  baseRefName: "main",
  headRefName: "feat/workspace-pull-requests",
  headRefOid: "a".repeat(40),
  additions: 120,
  deletions: 4,
  changedFiles: 9,
  reviewDecision: "REVIEW_REQUIRED",
  viewerDidAuthor: false,
  author: { login: "octocat" },
  commits: {
    totalCount: 3,
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: {
              totalCount: 5,
              nodes: [
                {
                  __typename: "CheckRun",
                  name: "test",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                },
                { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null },
                {
                  __typename: "CheckRun",
                  name: "e2e",
                  status: "COMPLETED",
                  conclusion: "TIMED_OUT",
                },
                {
                  __typename: "CheckRun",
                  name: "docs",
                  status: "COMPLETED",
                  conclusion: "SKIPPED",
                },
                { __typename: "StatusContext", context: "vercel", state: "SUCCESS" },
              ],
            },
          },
        },
      },
    ],
  },
  labels: { nodes: [{ name: "feature", color: "0e8a16" }] },
  comments: {
    totalCount: 1,
    nodes: [
      {
        id: "IC_1",
        body: "Looks good",
        createdAt: "2026-09-18T10:20:00Z",
        author: { login: "hubot" },
      },
    ],
  },
  reviews: {
    nodes: [
      {
        id: "PRR_1",
        body: "",
        state: "APPROVED",
        submittedAt: "2026-09-18T10:10:00Z",
        createdAt: "2026-09-18T10:05:00Z",
        author: { login: "reviewer" },
      },
      {
        id: "PRR_2",
        body: "",
        state: "COMMENTED",
        submittedAt: "2026-09-18T10:30:00Z",
        createdAt: "2026-09-18T10:30:00Z",
        author: { login: "reviewer" },
      },
      {
        id: "PRR_3",
        body: "draft thoughts",
        state: "PENDING",
        submittedAt: null,
        createdAt: "2026-09-18T10:40:00Z",
        author: { login: "reviewer" },
      },
    ],
  },
  ...overrides,
});
const response = (permission: string, overrides: Record<string, unknown> = {}) => ({
  data: {
    repository: {
      nameWithOwner: "hologramxyz/concors",
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
      viewerDefaultMergeMethod: "REBASE",
      viewerPermission: permission,
      pullRequest: pullRequest(overrides),
    },
  },
});

it("maps a pull request into the bounded detail clients render", () => {
  const { id, detail } = readPullRequestDetail(response("WRITE"));
  expect(id).toBe("PR_node");
  expect(PullRequestDetailSchema.safeParse(detail).success).toBe(true);
  expect(detail).toMatchObject({
    repository: "hologramxyz/concors",
    body: "Adds counts to the sidebar.",
    state: "open",
    mergeable: "mergeable",
    mergeState: "blocked",
    review: "review-required",
    // Rebase is disallowed here, so the preferred method falls back to the first allowed one.
    mergeMethods: ["squash", "merge"],
    defaultMergeMethod: "squash",
    canMerge: true,
    canClose: true,
    checkCount: 5,
    labels: [{ name: "feature", color: "0e8a16" }],
    commentCount: 1,
  });
  expect(detail.checks).toEqual([
    { name: "test", state: "passing" },
    { name: "lint", state: "pending" },
    { name: "e2e", state: "failing" },
    { name: "docs", state: "skipped" },
    { name: "vercel", state: "passing" },
  ]);
  // Oldest first; pending reviews and empty comment-only reviews are left out.
  expect(detail.timeline.map((entry) => [entry.id, entry.kind, entry.review])).toEqual([
    ["PRR_1", "review", "approved"],
    ["IC_1", "comment", null],
  ]);
});

it("only lets write access merge, and triage or authors close", () => {
  const read = readPullRequestDetail(response("READ")).detail;
  expect([read.canMerge, read.canClose]).toEqual([false, false]);
  const triage = readPullRequestDetail(response("TRIAGE")).detail;
  expect([triage.canMerge, triage.canClose]).toEqual([false, true]);
  const author = readPullRequestDetail(response("READ", { viewerDidAuthor: true })).detail;
  expect([author.canMerge, author.canClose, author.mine]).toEqual([false, true, true]);
});

it("marks long descriptions as cut and reports merged and closed pull requests", () => {
  const long = readPullRequestDetail(
    response("ADMIN", { body: "x".repeat(MAX_PULL_REQUEST_TEXT + 10), state: "MERGED" }),
  ).detail;
  expect(long.body).toHaveLength(MAX_PULL_REQUEST_TEXT);
  expect(long.bodyTruncated).toBe(true);
  expect(long.state).toBe("merged");
  expect(readPullRequestDetail(response("ADMIN", { state: "CLOSED" })).detail.state).toBe("closed");
});

it("explains a pull request that cannot be read", () => {
  expect(() =>
    readPullRequestDetail({
      data: { repository: null },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve" }],
    }),
  ).toThrow("not found");
  expect(() =>
    readPullRequestDetail(response("ADMIN", { url: "https://example.com/pull/7" })),
  ).toThrow("Unexpected");
});
