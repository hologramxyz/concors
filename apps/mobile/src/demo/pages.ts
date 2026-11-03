/**
 * What the demo's Pull requests and Schedules pages show, so someone exploring the app sees them
 * working rather than a request to update a daemon that does not exist. Pull requests are read-only:
 * nothing here reaches GitHub, and merging says so. Schedules change in memory and never run agents.
 */
import {
  AgentScheduleSchema,
  PullRequestDetailSchema,
  type AgentSchedule,
  type PullRequest,
  type PullRequestOperation,
  type PullRequestResult,
  type PullRequestState,
  type ScheduleDefinition,
  type ScheduleOperation,
  type ScheduleResult,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { ids } from "./fixtures";

const REPOSITORY = "concors-demo/mobile";
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const VIEWER = "alex-morgan";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function pullRequest(
  number: number,
  title: string,
  state: PullRequestState,
  details: Partial<PullRequest> = {},
): PullRequest {
  return {
    number,
    title,
    url: `${REPOSITORY_URL}/pull/${number}`,
    author: VIEWER,
    mine: true,
    draft: false,
    branch: `demo/${number}`,
    createdAt: hoursAgo(number),
    updatedAt: hoursAgo(1),
    review: null,
    checks: "passing",
    state,
    ...details,
  };
}
const pullRequests = (): PullRequest[] => [
  pullRequest(42, "Keep the composer at the bottom of the screen", "open", { review: "approved" }),
  pullRequest(41, "Open the sidebar with a swipe", "open", {
    author: "sam-rivera",
    mine: false,
    review: "review-required",
    checks: "pending",
  }),
  pullRequest(38, "Draft: show each agent's status in the Tabs sheet", "open", { draft: true }),
  pullRequest(35, "Reopen the last tab at launch", "merged", { review: "approved" }),
  pullRequest(31, "Replace bottom tabs with a sidebar", "closed", { checks: null }),
];

function detail(number: number) {
  const found = pullRequests().find((item) => item.number === number);
  if (!found) return null;
  return PullRequestDetailSchema.parse({
    repository: REPOSITORY,
    number,
    title: found.title,
    url: found.url,
    body: "A sample pull request. Everything in this preview is simulated.",
    bodyTruncated: false,
    state: found.state ?? "open",
    draft: found.draft,
    author: found.author,
    mine: found.mine,
    baseBranch: "main",
    headBranch: found.branch,
    headSha: "a".repeat(40),
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
    commits: 3,
    additions: 128,
    deletions: 42,
    changedFiles: 6,
    review: found.review,
    mergeable: "mergeable",
    mergeState: "clean",
    mergeMethods: ["squash"],
    defaultMergeMethod: "squash",
    canMerge: false,
    canClose: false,
    checks: found.checks ? [{ name: "Tests", state: found.checks }] : [],
    checkCount: found.checks ? 1 : 0,
    labels: [],
    timeline: [],
    commentCount: 0,
  });
}

type PullRequestOutcome = PullRequestResult["outcome"];
export function demoPullRequests(
  operation: PullRequestOperation,
  workspace: WorkspaceSnapshot,
): PullRequestOutcome {
  if (operation.kind === "list") {
    const state = operation.state ?? "open";
    const listed = pullRequests().filter((item) => item.state === state);
    return {
      status: "listed",
      viewer: VIEWER,
      fetchedAt: Date.now(),
      state,
      workspaces: operation.projects.flatMap(({ projectId }) => {
        const project = workspace.projects.find((item) => item.id === projectId);
        if (!project?.directory) return [];
        return [
          {
            projectId,
            directory: project.directory,
            // Workspaces added while exploring have no repository to list.
            repositories:
              projectId === ids.project
                ? [
                    {
                      name: REPOSITORY,
                      url: REPOSITORY_URL,
                      folders: [""],
                      openCount: listed.length,
                      pullRequests: listed,
                      error: null,
                      permission: "read" as const,
                    },
                  ]
                : [],
          },
        ];
      }),
    };
  }
  if (operation.kind !== "detail")
    return { status: "error", message: "The demo cannot change pull requests." };
  const found = detail(operation.number);
  return found
    ? { status: "detail", detail: found }
    : { status: "error", message: "That pull request is not part of the demo." };
}

function nextRun(schedule: ScheduleDefinition) {
  if (!schedule.enabled) return null;
  const minutes = schedule.cadence.kind === "interval" ? schedule.cadence.minutes : 24 * 60;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
function schedule(id: string, definition: ScheduleDefinition, revision = 0): AgentSchedule {
  return AgentScheduleSchema.parse({
    ...definition,
    id,
    revision,
    source: "user",
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(1),
    nextRunAt: nextRun(definition),
    sessionId: null,
    runs: [],
  });
}
export function demoSchedules(): AgentSchedule[] {
  const target = { kind: "agent", provider: "codex", model: null } as const;
  const review = schedule("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
    name: "Morning review",
    projectId: ids.project,
    prompt: "Summarize what changed overnight and flag anything risky.",
    target,
    cadence: { kind: "daily", time: "09:00", timezone: "UTC" },
    enabled: true,
  });
  return [
    {
      ...review,
      runs: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          scheduledAt: hoursAgo(24),
          startedAt: hoursAgo(24),
          finishedAt: hoursAgo(23.9),
          sessionId: null,
          turnId: null,
          status: "done",
          message: null,
        },
      ],
    },
    schedule("dddddddd-dddd-4ddd-8ddd-dddddddddddd", {
      name: "Dependency check",
      projectId: ids.project,
      prompt: "Look for outdated dependencies and propose the safe updates.",
      target,
      cadence: { kind: "weekly", time: "08:30", timezone: "UTC", days: [1] },
      enabled: false,
    }),
  ];
}

/** The schedules after `operation`, or why it cannot apply. */
export function applyDemoSchedule(
  schedules: AgentSchedule[],
  operation: ScheduleOperation,
): AgentSchedule[] | string {
  if (operation.kind === "list") return schedules;
  if (operation.kind === "create")
    return [...schedules, schedule(crypto.randomUUID(), operation.schedule)];
  const current = schedules.find((item) => item.id === operation.id);
  if (!current) return "That schedule no longer exists.";
  if (operation.kind === "run") return "The demo does not run agents.";
  if (operation.expectedRevision !== current.revision) return "That schedule changed. Try again.";
  if (operation.kind === "delete") return schedules.filter((item) => item.id !== operation.id);
  return schedules.map((item) =>
    item.id === operation.id
      ? {
          ...schedule(item.id, operation.schedule, item.revision + 1),
          createdAt: item.createdAt,
          runs: item.runs,
        }
      : item,
  );
}

export function demoScheduleOutcome(result: AgentSchedule[] | string): ScheduleResult["outcome"] {
  return typeof result === "string"
    ? { status: "error", message: result }
    : { status: "ok", schedules: result };
}
