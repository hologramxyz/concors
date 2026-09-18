import { z } from "zod";
import {
  MAX_PULL_REQUEST_TEXT,
  type MergeMethod,
  type PullRequestCheck,
  type PullRequestDetail,
  type PullRequestTimelineEntry,
} from "@concors/protocol";
import { clip, gitHubGraphQL } from "./graphql.ts";
import type { GitHubRepository } from "./remotes.ts";

/**
 * One pull request as Concors shows it before merging or closing: description, merge readiness,
 * checks and the recent conversation. `id` is GitHub's node ID, which mutations need; it stays in
 * the daemon.
 */
export interface PullRequestRecord {
  readonly id: string;
  readonly detail: PullRequestDetail;
}

export const PULL_REQUEST_DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    viewerDefaultMergeMethod viewerPermission
    pullRequest(number: $number) {
      id number title url body state isDraft mergeable mergeStateStatus
      createdAt updatedAt baseRefName headRefName headRefOid
      additions deletions changedFiles reviewDecision viewerDidAuthor
      author { login }
      commits(last: 1) {
        totalCount
        nodes { commit { statusCheckRollup { contexts(first: 50) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        } } } }
      }
      labels(first: 20) { nodes { name color } }
      comments(last: 30) { totalCount nodes { id body createdAt author { login } } }
      reviews(last: 20) { nodes { id body state submittedAt createdAt author { login } } }
    }
  }
}`;

const Login = z.object({ login: z.string() }).nullish();
const Context = z.union([
  z.object({
    __typename: z.literal("CheckRun"),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
  }),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), state: z.string() }),
  z.object({ __typename: z.string() }),
]);
const PullRequestNode = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  reviewDecision: z.string().nullish(),
  viewerDidAuthor: z.boolean(),
  author: Login,
  commits: z.object({
    totalCount: z.number().int().nonnegative(),
    nodes: z
      .array(
        z
          .object({
            commit: z.object({
              statusCheckRollup: z
                .object({
                  contexts: z.object({
                    totalCount: z.number().int().nonnegative(),
                    nodes: z.array(Context.nullish()).nullish(),
                  }),
                })
                .nullish(),
            }),
          })
          .nullish(),
      )
      .nullish(),
  }),
  labels: z
    .object({
      nodes: z.array(z.object({ name: z.string(), color: z.string() }).nullish()).nullish(),
    })
    .nullish(),
  comments: z.object({
    totalCount: z.number().int().nonnegative(),
    nodes: z
      .array(
        z
          .object({ id: z.string(), body: z.string(), createdAt: z.string(), author: Login })
          .nullish(),
      )
      .nullish(),
  }),
  reviews: z
    .object({
      nodes: z
        .array(
          z
            .object({
              id: z.string(),
              body: z.string(),
              state: z.string(),
              submittedAt: z.string().nullish(),
              createdAt: z.string(),
              author: Login,
            })
            .nullish(),
        )
        .nullish(),
    })
    .nullish(),
});
const RepositoryNode = z.object({
  nameWithOwner: z.string(),
  mergeCommitAllowed: z.boolean(),
  squashMergeAllowed: z.boolean(),
  rebaseMergeAllowed: z.boolean(),
  viewerDefaultMergeMethod: z.string().nullish(),
  viewerPermission: z.string().nullish(),
  pullRequest: PullRequestNode.nullish(),
});
const Response = z.object({
  data: z.object({ repository: RepositoryNode.nullish() }).nullish(),
  errors: z
    .array(z.object({ type: z.string().optional(), message: z.string().optional() }))
    .optional(),
});

const methods: Record<string, MergeMethod> = { SQUASH: "squash", MERGE: "merge", REBASE: "rebase" };
const reviews: Record<string, PullRequestDetail["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
};
const reviewStates: Record<string, PullRequestTimelineEntry["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};
const mergeStates: Record<string, PullRequestDetail["mergeState"]> = {
  CLEAN: "clean",
  UNSTABLE: "unstable",
  HAS_HOOKS: "has-hooks",
  BLOCKED: "blocked",
  BEHIND: "behind",
  DIRTY: "dirty",
  DRAFT: "draft",
};

export function checkState(context: z.infer<typeof Context>): PullRequestCheck["state"] | null {
  if (context.__typename === "CheckRun" && "status" in context) {
    if (context.status !== "COMPLETED") return "pending";
    if (context.conclusion === "SUCCESS") return "passing";
    if (["SKIPPED", "NEUTRAL", "STALE"].includes(context.conclusion ?? "")) return "skipped";
    return "failing";
  }
  if (context.__typename === "StatusContext" && "state" in context)
    return context.state === "SUCCESS"
      ? "passing"
      : ["PENDING", "EXPECTED"].includes(context.state)
        ? "pending"
        : "failing";
  return null;
}

function text(body: string) {
  // Pull request templates are mostly HTML comments; they are not part of what people wrote.
  const visible = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  return {
    body: clip(visible, MAX_PULL_REQUEST_TEXT),
    truncated: visible.length > MAX_PULL_REQUEST_TEXT,
  };
}

export function readPullRequestDetail(body: unknown): PullRequestRecord {
  const response = Response.parse(body);
  const repository = response.data?.repository;
  const node = repository?.pullRequest;
  if (!repository || !node) {
    const error = response.errors?.[0];
    throw new Error(
      !error || error.type === "NOT_FOUND"
        ? "This pull request was not found, or this machine's GitHub account cannot see it."
        : clip(error.message ?? "GitHub could not load this pull request.", 500),
    );
  }
  if (!node.url.startsWith("https://github.com/")) throw new Error("Unexpected pull request URL.");
  const permission = repository.viewerPermission ?? "";
  const canMerge = ["ADMIN", "MAINTAIN", "WRITE"].includes(permission);
  const rollup = node.commits.nodes?.at(-1)?.commit.statusCheckRollup;
  const checks = (rollup?.contexts.nodes ?? []).flatMap((context) => {
    const state = context ? checkState(context) : null;
    if (!context || !state) return [];
    const name = "name" in context ? context.name : "context" in context ? context.context : "";
    return [{ name: clip(name, 200), state }];
  });
  const described = text(node.body);
  const timeline: PullRequestTimelineEntry[] = [
    ...(node.comments.nodes ?? []).flatMap((comment) => {
      if (!comment) return [];
      const content = text(comment.body);
      return [
        {
          id: clip(comment.id, 200),
          kind: "comment" as const,
          author: comment.author ? clip(comment.author.login, 100) : null,
          body: content.body,
          truncated: content.truncated,
          createdAt: clip(comment.createdAt, 40),
          review: null,
        },
      ];
    }),
    ...(node.reviews?.nodes ?? []).flatMap((review) => {
      const state = review ? reviewStates[review.state] : undefined;
      // Pending reviews are private drafts; a comment-only review without text says nothing.
      if (!review || !state || (state === "commented" && !review.body.trim())) return [];
      const content = text(review.body);
      return [
        {
          id: clip(review.id, 200),
          kind: "review" as const,
          author: review.author ? clip(review.author.login, 100) : null,
          body: content.body,
          truncated: content.truncated,
          createdAt: clip(review.submittedAt ?? review.createdAt, 40),
          review: state,
        },
      ];
    }),
  ]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-50);
  const allowed: MergeMethod[] = [
    ...(repository.squashMergeAllowed ? (["squash"] as const) : []),
    ...(repository.mergeCommitAllowed ? (["merge"] as const) : []),
    ...(repository.rebaseMergeAllowed ? (["rebase"] as const) : []),
  ];
  const preferred = methods[repository.viewerDefaultMergeMethod ?? ""];
  return {
    id: node.id,
    detail: {
      repository: clip(repository.nameWithOwner, 200),
      number: node.number,
      title: clip(node.title, 1024),
      url: clip(node.url, 2048),
      body: described.body,
      bodyTruncated: described.truncated,
      state: node.state === "OPEN" ? "open" : node.state === "MERGED" ? "merged" : "closed",
      draft: node.isDraft,
      author: node.author ? clip(node.author.login, 100) : null,
      mine: node.viewerDidAuthor,
      baseBranch: clip(node.baseRefName, 255),
      headBranch: clip(node.headRefName, 255),
      headSha: node.headRefOid,
      createdAt: clip(node.createdAt, 40),
      updatedAt: clip(node.updatedAt, 40),
      commits: node.commits.totalCount,
      additions: node.additions,
      deletions: node.deletions,
      changedFiles: node.changedFiles,
      review: reviews[node.reviewDecision ?? ""] ?? null,
      mergeable:
        node.mergeable === "MERGEABLE"
          ? "mergeable"
          : node.mergeable === "CONFLICTING"
            ? "conflicting"
            : "unknown",
      mergeState: mergeStates[node.mergeStateStatus] ?? "unknown",
      mergeMethods: allowed,
      defaultMergeMethod:
        preferred && allowed.includes(preferred) ? preferred : (allowed[0] ?? null),
      canMerge,
      canClose: canMerge || permission === "TRIAGE" || node.viewerDidAuthor,
      checks: checks.slice(0, 50),
      checkCount: rollup?.contexts.totalCount ?? 0,
      labels: (node.labels?.nodes ?? [])
        .flatMap((label) =>
          label && /^[0-9a-fA-F]{6}$/.test(label.color)
            ? [{ name: clip(label.name, 100), color: label.color }]
            : [],
        )
        .slice(0, 20),
      timeline,
      commentCount: node.comments.totalCount,
    },
  };
}

export async function fetchPullRequestDetail(
  token: string,
  repository: GitHubRepository,
  number: number,
  request: typeof fetch = fetch,
): Promise<PullRequestRecord> {
  return readPullRequestDetail(
    await gitHubGraphQL(
      token,
      PULL_REQUEST_DETAIL_QUERY,
      { owner: repository.owner, name: repository.name, number },
      request,
    ),
  );
}
