import { expect, it } from "vitest";
import { lastTargetKey, parseLastTargets, rememberTarget } from "./last-target";

it("keeps one tab per account and machine, newest last, and drops the oldest past the limit", () => {
  let targets = parseLastTargets(null);
  for (let index = 0; index < 22; index += 1)
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
  expect(Object.keys(targets)).toHaveLength(20);
  expect(targets["user:machine-0"]).toBeUndefined();
  expect(targets["user:machine-1"]).toBeUndefined();
  expect(Object.keys(targets).at(-1)).toBe("user:machine-5");
  // Only the physical tab is kept: a session moves between panes.
  expect(targets["user:machine-5"]).toEqual({ projectId: "project", tabId: "tab", paneId: "pane" });
  expect(parseLastTargets(JSON.stringify(targets))).toEqual(targets);
});

it("ignores stored values it cannot read", () => {
  expect(parseLastTargets("not json")).toEqual({});
  expect(parseLastTargets('{"user:machine":{"projectId":7}}')).toEqual({});
  expect(parseLastTargets("[]")).toEqual({});
});
