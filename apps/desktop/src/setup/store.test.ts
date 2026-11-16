import { expect, it } from "vitest";
import { opensSetup, parseSetupRecord } from "./store";

it("reads what was saved, and treats anything unreadable as never having run", () => {
  expect(parseSetupRecord(null)).toEqual({ status: "none" });
  expect(parseSetupRecord("{")).toEqual({ status: "none" });
  expect(parseSetupRecord(JSON.stringify({ status: "done", outcome: "finished" }))).toEqual({
    status: "done",
    outcome: "finished",
  });
  expect(parseSetupRecord(JSON.stringify({ status: "done" }))).toEqual({
    status: "done",
    outcome: "skipped",
  });
  expect(
    parseSetupRecord(
      JSON.stringify({ status: "open", step: 2.7, where: "cloud", machineId: "m", size: "small" }),
    ),
  ).toEqual({ status: "open", step: 2, where: "cloud", machineId: "m", size: "small" });
  expect(parseSetupRecord(JSON.stringify({ status: "open", step: 1, where: "moon" }))).toEqual({
    status: "open",
    step: 1,
  });
});

it("opens for someone with no workspaces, or to finish a setup left open, and never again after", () => {
  expect(opensSetup({ status: "none" }, false)).toBe(true);
  // Someone who already works in Concors is never stopped by it.
  expect(opensSetup({ status: "none" }, true)).toBe(false);
  // Signing in, or quitting, part-way brings it back where it was, workspaces or not.
  expect(opensSetup({ status: "open", step: 3 }, true)).toBe(true);
  expect(opensSetup({ status: "done", outcome: "skipped" }, false)).toBe(false);
  expect(opensSetup({ status: "done", outcome: "finished" }, false)).toBe(false);
});
