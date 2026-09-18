import { z } from "zod";

export const PULL_REQUESTS_CAPABILITY = "workspace-pull-requests";
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
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PullRequestRepositorySchema = z.object({
  /** `owner/name` on GitHub. */
  name: z.string().max(200),
  url: GitHubUrl,
  /** Workspace folders using this repository: "" is the workspace itself, otherwise a child name. */
  folders: z.array(z.string().max(255)).max(MAX_WORKSPACE_REPOSITORIES),
  openCount: z.number().int().nonnegative(),
  pullRequests: z.array(PullRequestSchema).max(MAX_PULL_REQUESTS_PER_REPOSITORY),
  error: z.string().max(500).nullable(),
});
export type PullRequestRepository = z.infer<typeof PullRequestRepositorySchema>;

export const WorkspacePullRequestsSchema = z.object({
  projectId: Id,
  directory: z.string().max(4096),
  repositories: z.array(PullRequestRepositorySchema).max(MAX_WORKSPACE_REPOSITORIES),
});
export type WorkspacePullRequests = z.infer<typeof WorkspacePullRequestsSchema>;

export const PullRequestOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    epoch: Id,
    projects: z
      .array(z.object({ projectId: Id, directory: z.string().min(1).max(4096).optional() }))
      .max(64),
    /** Skip the machine's short-lived cache, for an explicit refresh. */
    refresh: z.boolean().optional(),
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
      workspaces: z.array(WorkspacePullRequestsSchema).max(64),
    }),
    /** The machine has no GitHub credentials; workspaces are not queried. */
    z.object({ status: z.literal("signed-out"), message: z.string().max(1000) }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type PullRequestResult = z.infer<typeof PullRequestResultSchema>;
