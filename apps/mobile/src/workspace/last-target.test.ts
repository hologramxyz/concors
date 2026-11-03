import { expect, it } from "vitest";
import {
  lastTargetKey,
  lastWorkspaceTargets,
  parseLastTargets,
  rememberTarget,
  rememberVisit,
} from "./last-target";

it("keeps one tab per account and machine, newest last, and drops the oldest past the limit", () => {
  let targets = parseLastTargets(null);
  for (let index = 0; index < 42; index += 1)
    targets = rememberTarget(targets, lastTargetKey("user", `machine-${index}`), {
      projectId: "project",
      tabId: `tab-${index}`,
    });
  targets = rememberTarget(targets, lastTargetKey("user", "machine-5"), {
    machineId: "machine-5",
    projectId: "project",
    tabId: "tab",
    paneId: "pane",
    sessionId: "session",
  });
  expect(Object.keys(targets)).toHaveLength(40);
  expect(targets["user:machine-0"]).toBeUndefined();
  expect(targets["user:machine-1"]).toBeUndefined();
  expect(Object.keys(targets).at(-1)).toBe("user:machine-5");
  // Only the physical tab is kept: a session moves between panes.
  expect(targets["user:machine-5"]).toEqual({ projectId: "project", tabId: "tab", paneId: "pane" });
  expect(parseLastTargets(JSON.stringify(targets))).toEqual(targets);
});

it("remembers a tab per workspace, apart from the machine's last tab and other machines", () => {
  let targets = parseLastTargets(null);
  targets = rememberVisit(targets, "user", "machine", { projectId: "a", tabId: "a2", paneId: "p" });
  targets = rememberVisit(targets, "user", "machine", { projectId: "b", tabId: "b2", paneId: "q" });
  targets = rememberVisit(targets, "user", "other", { projectId: "c", tabId: "c1", paneId: "r" });
  targets = rememberVisit(targets, "other", "machine", { projectId: "d", tabId: "d1" });
  expect(targets[lastTargetKey("user", "machine")]).toEqual({
    projectId: "b",
    tabId: "b2",
    paneId: "q",
  });
  expect(lastWorkspaceTargets(targets, "user", "machine")).toEqual({
    a: { projectId: "a", tabId: "a2", paneId: "p" },
    b: { projectId: "b", tabId: "b2", paneId: "q" },
  });
  expect(parseLastTargets(JSON.stringify(targets))).toEqual(targets);
});

it("reads what an earlier version stored, which has no workspace entries", () => {
  const stored = parseLastTargets('{"user:machine":{"projectId":"a","tabId":"a2"}}');
  expect(stored["user:machine"]).toEqual({ projectId: "a", tabId: "a2" });
  expect(lastWorkspaceTargets(stored, "user", "machine")).toEqual({});
});

it("keeps a busy machine's last tab while forgetting its oldest workspaces", () => {
  let targets = parseLastTargets(null);
  for (let index = 0; index < 60; index += 1)
    targets = rememberVisit(targets, "user", "busy", { projectId: `p${index}`, tabId: "t" });
  expect(Object.keys(targets)).toHaveLength(40);
  expect(targets[lastTargetKey("user", "busy")]).toEqual({ projectId: "p59", tabId: "t" });
});

it("ignores stored values it cannot read", () => {
  expect(parseLastTargets("not json")).toEqual({});
  expect(parseLastTargets('{"user:machine":{"projectId":7}}')).toEqual({});
  expect(parseLastTargets("[]")).toEqual({});
});
