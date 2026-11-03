import { expect, it } from "vitest";
import { PullRequestResultSchema, ScheduleListSchema } from "@concors/protocol";
import { demoWorkspace, ids } from "./fixtures";
import { applyDemoSchedule, demoPullRequests, demoSchedules } from "./pages";

const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const list = (state?: "open" | "merged" | "closed") => ({
  kind: "list" as const,
  epoch: ids.epoch,
  projects: [{ projectId: ids.project }],
  ...(state ? { state } : {}),
});
const target = {
  epoch: ids.epoch,
  projectId: ids.project,
  repository: "concors-demo/mobile",
  number: 42,
};

it("lists each state's pull requests in what the protocol accepts", () => {
  for (const state of ["open", "merged", "closed"] as const) {
    const outcome = demoPullRequests(list(state), demoWorkspace);
    PullRequestResultSchema.parse({ type: "pull-request.result", requestId, outcome });
    if (outcome.status !== "listed") throw new Error(outcome.status);
    const repository = outcome.workspaces[0]?.repositories[0];
    expect(repository?.pullRequests.length).toBeGreaterThan(0);
    expect(repository?.pullRequests.every((item) => item.state === state)).toBe(true);
    expect(repository?.openCount).toBe(repository?.pullRequests.length);
  }
  expect(demoPullRequests(list(), demoWorkspace)).toMatchObject({ state: "open" });
});

it("opens every listed pull request read-only and refuses to change one", () => {
  const outcome = demoPullRequests({ kind: "detail", ...target }, demoWorkspace);
  PullRequestResultSchema.parse({ type: "pull-request.result", requestId, outcome });
  expect(outcome).toMatchObject({ status: "detail", detail: { canMerge: false, canClose: false } });
  expect(demoPullRequests({ kind: "detail", ...target, number: 1 }, demoWorkspace).status).toBe(
    "error",
  );
  expect(
    demoPullRequests(
      { kind: "merge", ...target, method: "squash", expectedHeadSha: "a".repeat(40) },
      demoWorkspace,
    ).status,
  ).toBe("error");
});

it("keeps schedule changes in memory, checks revisions, and never runs an agent", () => {
  const schedules = demoSchedules();
  ScheduleListSchema.parse({ type: "schedule.list", schedules });
  const [first] = schedules;
  if (!first) throw new Error("Missing demo schedule");
  const { id, revision, name, projectId, prompt, target: agent, cadence } = first;
  const definition = { name, projectId, prompt, target: agent, cadence, enabled: false };
  const updated = applyDemoSchedule(schedules, {
    kind: "update",
    id,
    expectedRevision: revision,
    schedule: definition,
  });
  if (typeof updated === "string") throw new Error(updated);
  expect(updated[0]).toMatchObject({ enabled: false, nextRunAt: null, revision: revision + 1 });
  expect(updated[0]?.runs).toEqual(first.runs);
  expect(
    applyDemoSchedule(updated, {
      kind: "delete",
      id,
      expectedRevision: revision,
    }),
  ).toMatch(/changed/);
  const created = applyDemoSchedule(schedules, { kind: "create", schedule: definition });
  expect(created).toHaveLength(schedules.length + 1);
  expect(applyDemoSchedule(schedules, { kind: "run", id })).toMatch(/does not run/);
  expect(
    applyDemoSchedule(schedules, { kind: "delete", id, expectedRevision: revision }),
  ).toHaveLength(schedules.length - 1);
});
