import { describe, expect, it } from "vitest";
import {
  MAX_RETAINED_PROJECTS,
  RETAINED_PROJECT_TTL_MS,
  nextExpiry,
  retainProjects,
  type RetainedProject,
} from "./retained-projects";

const ids = (entries: readonly RetainedProject[]) => entries.map((entry) => entry.id);
const all = (count: number) => new Set(Array.from({ length: count }, (_, i) => `p${i}`));

describe("retainProjects", () => {
  it("keeps the selected project first and the ones left behind after it, most recent first", () => {
    let entries = retainProjects([], "p0", all(3), 0);
    entries = retainProjects(entries, "p1", all(3), 1_000);
    entries = retainProjects(entries, "p2", all(3), 2_000);
    expect(entries).toEqual([
      { id: "p2", inactiveSince: null },
      { id: "p1", inactiveSince: 2_000 },
      { id: "p0", inactiveSince: 1_000 },
    ]);
  });

  it(`keeps at most ${MAX_RETAINED_PROJECTS}, letting the least recently used go`, () => {
    const existing = all(MAX_RETAINED_PROJECTS + 2);
    let entries: readonly RetainedProject[] = [];
    for (const [index, id] of [...existing].entries())
      entries = retainProjects(entries, id, existing, index);
    expect(entries).toHaveLength(MAX_RETAINED_PROJECTS);
    expect(ids(entries)).not.toContain("p0");
    expect(ids(entries)).not.toContain("p1");
    expect(ids(entries)[0]).toBe(`p${MAX_RETAINED_PROJECTS + 1}`);
  });

  it("lets a project hidden for ten minutes go, and keeps the selected one however long", () => {
    let entries = retainProjects([], "p0", all(2), 0);
    entries = retainProjects(entries, "p1", all(2), 0);
    expect(ids(retainProjects(entries, "p1", all(2), RETAINED_PROJECT_TTL_MS - 1))).toEqual([
      "p1",
      "p0",
    ]);
    expect(ids(retainProjects(entries, "p1", all(2), RETAINED_PROJECT_TTL_MS))).toEqual(["p1"]);
  });

  it("drops projects that were removed, and returns the same list when nothing changes", () => {
    let entries = retainProjects([], "p0", all(2), 0);
    entries = retainProjects(entries, "p1", all(2), 0);
    expect(retainProjects(entries, "p1", all(2), 5)).toBe(entries);
    expect(ids(retainProjects(entries, "p1", new Set(["p1"]), 5))).toEqual(["p1"]);
  });
});

describe("nextExpiry", () => {
  it("is the time left for the hidden project closest to expiring", () => {
    const entries = [
      { id: "p2", inactiveSince: null },
      { id: "p1", inactiveSince: 4_000 },
      { id: "p0", inactiveSince: 1_000 },
    ];
    expect(nextExpiry(entries, 5_000)).toBe(RETAINED_PROJECT_TTL_MS - 4_000);
    expect(nextExpiry([{ id: "p0", inactiveSince: null }], 5_000)).toBeNull();
  });
});
