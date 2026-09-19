import { z } from "zod";

export const PULL_REQUESTS_CAPABILITY = "workspace-pull-requests";
/** Detail, merge, close and comment; listing alone only needs PULL_REQUESTS_CAPABILITY. */
export const PULL_REQUEST_ACTIONS_CAPABILITY = "pull-request-actions";
/** Listing merged or closed pull requests, and each repository's permission. */
export const PULL_REQUEST_STATES_CAPABILITY = "pull-request-states";
export const PullRequestStateSchema = z.enum(["open", "merged", "closed"]);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;
/** Each repository lists its most recently updated open pull requests; `openCount` has the rest. */
export const MAX_PULL_REQUESTS_PER_REPOSITORY = 25;
export const MAX_WORKSPACE_REPOSITORIES = 32;
const Id = z.string().uuid();
const GitHubUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/github\.com\//);

export const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(1024),
  url: GitHubUrl,
  author: z.string().max(100).nullable(),
  /** The machine's GitHub account opened it. */
  mine: z.boolean(),
  draft: z.boolean(),
  branch: z.string().max(255),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  review: z.enum(["approved", "changes-requested", "review-required"]).nullable(),
  checks: z.enum(["passing", "failing", "pending"]).nullable(),
  /** Absent from older daemons, which only list open pull requests. */
  state: PullRequestStateSchema.optional(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PullRequestRepositorySchema = z.object({
  /** `owner/name` on GitHub. */
  name: z.string().max(200),
  url: GitHubUrl,
  /** Workspace folders using this repository: "" is the workspace itself, otherwise a child name. */
  folders: z.array(z.string().max(255)).max(MAX_WORKSPACE_REPOSITORIES),
  /** Pull requests in the listed state: open (drafts included) unless merged or closed was asked. */
  openCount: z.number().int().nonnegative(),
  pullRequests: z.array(PullRequestSchema).max(MAX_PULL_REQUESTS_PER_REPOSITORY),
  error: z.string().max(500).nullable(),
  /** The machine's GitHub access, which decides whether rows offer Merge and Close. */
  permission: z.enum(["admin", "maintain", "write", "triage", "read"]).nullable().optional(),
});
export type PullRequestRepository = z.infer<typeof PullRequestRepositorySchema>;

export const WorkspacePullRequestsSchema = z.object({
  projectId: Id,
  directory: z.string().max(4096),
  repositories: z.array(PullRequestRepositorySchema).max(MAX_WORKSPACE_REPOSITORIES),
});
export type WorkspacePullRequests = z.infer<typeof WorkspacePullRequestsSchema>;

/** GitHub's own limit for a comment body. */
export const MAX_PULL_REQUEST_COMMENT = 65_536;
/** Descriptions and comments longer than this are cut, with a link to read the rest. */
export const MAX_PULL_REQUEST_TEXT = 20_000;
export const MergeMethodSchema = z.enum(["squash", "merge", "rebase"]);
export type MergeMethod = z.infer<typeof MergeMethodSchema>;
const Review = z.enum(["approved", "changes-requested", "review-required"]).nullable();

export const PullRequestCheckSchema = z.object({
  name: z.string().max(200),
  state: z.enum(["passing", "failing", "pending", "skipped"]),
});
export type PullRequestCheck = z.infer<typeof PullRequestCheckSchema>;

export const PullRequestTimelineEntrySchema = z.object({
  id: z.string().max(200),
  kind: z.enum(["comment", "review"]),
  author: z.string().max(100).nullable(),
  body: z.string().max(MAX_PULL_REQUEST_TEXT),
  truncated: z.boolean(),
  createdAt: z.string().max(40),
  /** Set for reviews. */
  review: z.enum(["approved", "changes-requested", "commented", "dismissed"]).nullable(),
});
export type PullRequestTimelineEntry = z.infer<typeof PullRequestTimelineEntrySchema>;

export const PullRequestDetailSchema = z.object({
  repository: z.string().max(200),
  number: z.number().int().positive(),
  title: z.string().max(1024),
  url: GitHubUrl,
  body: z.string().max(MAX_PULL_REQUEST_TEXT),
  bodyTruncated: z.boolean(),
  state: z.enum(["open", "closed", "merged"]),
  draft: z.boolean(),
  author: z.string().max(100).nullable(),
  mine: z.boolean(),
  baseBranch: z.string().max(255),
  headBranch: z.string().max(255),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  commits: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  review: Review,
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  /** GitHub's mergeStateStatus: whether merging is currently clean, blocked or impossible. */
  mergeState: z.enum([
    "clean",
    "unstable",
    "has-hooks",
    "blocked",
    "behind",
    "dirty",
    "draft",
    "unknown",
  ]),
  mergeMethods: z.array(MergeMethodSchema).max(3),
  defaultMergeMethod: MergeMethodSchema.nullable(),
  /** The machine's GitHub account can merge (write access) and close (triage, or its own). */
  canMerge: z.boolean(),
  canClose: z.boolean(),
  checks: z.array(PullRequestCheckSchema).max(50),
  checkCount: z.number().int().nonnegative(),
  labels: z
    .array(z.object({ name: z.string().max(100), color: z.string().regex(/^[0-9a-fA-F]{6}$/) }))
    .max(20),
  /** Oldest first: the most recent comments and reviews. */
  timeline: z.array(PullRequestTimelineEntrySchema).max(50),
  commentCount: z.number().int().nonnegative(),
});
export type PullRequestDetail = z.infer<typeof PullRequestDetailSchema>;

const PullRequestTarget = {
  epoch: Id,
  projectId: Id,
  directory: z.string().min(1).max(4096).optional(),
  /** `owner/name`; it must be one of the workspace's repositories. */
  repository: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  number: z.number().int().positive(),
};

export const PullRequestOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    epoch: Id,
    projects: z
      .array(z.object({ projectId: Id, directory: z.string().min(1).max(4096).optional() }))
      .max(64),
    /** Skip the machine's short-lived cache, for an explicit refresh. */
    refresh: z.boolean().optional(),
    /** Open when absent. Merged and closed need PULL_REQUEST_STATES_CAPABILITY. */
    state: PullRequestStateSchema.optional(),
  }),
  z.object({ kind: z.literal("detail"), ...PullRequestTarget }),
  z.object({
    kind: z.literal("merge"),
    ...PullRequestTarget,
    method: MergeMethodSchema,
    /** The head the person reviewed; GitHub refuses the merge if newer commits arrived. */
    expectedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  z.object({
    kind: z.literal("close"),
    ...PullRequestTarget,
    /** Posted before closing, like GitHub's Close with comment. */
    comment: z.string().trim().min(1).max(MAX_PULL_REQUEST_COMMENT).optional(),
  }),
  z.object({
    kind: z.literal("comment"),
    ...PullRequestTarget,
    body: z.string().trim().min(1).max(MAX_PULL_REQUEST_COMMENT),
  }),
]);
export type PullRequestOperation = z.infer<typeof PullRequestOperationSchema>;

export const PullRequestRequestSchema = z.object({
  type: z.literal("pull-request.request"),
  requestId: Id,
  operation: PullRequestOperationSchema,
});
export type PullRequestRequest = z.infer<typeof PullRequestRequestSchema>;

export const PullRequestResultSchema = z.object({
  type: z.literal("pull-request.result"),
  requestId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("listed"),
      /** GitHub login of the machine's account. */
      viewer: z.string().max(100).nullable(),
      fetchedAt: z.number().int().nonnegative(),
      state: PullRequestStateSchema.optional(),
      workspaces: z.array(WorkspacePullRequestsSchema).max(64),
    }),
    z.object({ status: z.literal("detail"), detail: PullRequestDetailSchema }),
    /** A merge, close or comment succeeded; `detail` is the pull request afterwards. */
    z.object({
      status: z.literal("updated"),
      action: z.enum(["merged", "closed", "commented"]),
      detail: PullRequestDetailSchema,
    }),
    /** The machine has no GitHub credentials; workspaces are not queried. */
    z.object({ status: z.literal("signed-out"), message: z.string().max(1000) }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type PullRequestResult = z.infer<typeof PullRequestResultSchema>;
