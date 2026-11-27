import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { supervisorReferences } from "./reference-context";
import { matchReferences, mentionGroups } from "./reference-text";

const project = "00000000-0000-4000-8000-0000000000aa";
const agent = (id: number, name: string, updatedAt: string, patch: Partial<AgentInfo> = {}) =>
  ({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    projectId: project,
    name,
    updatedAt,
    ...patch,
  }) as AgentInfo;

it("offers the sessions just run first, then workspaces", () => {
  const references = supervisorReferences(
    { projects: [{ id: project, name: "To-do App" }] as never, closedProjects: [] },
    [
      agent(1, "Old test", "2026-11-03T10:00:00.000Z"),
      agent(2, "To-do tester", "2026-11-20T10:05:00.000Z"),
      agent(3, "Supervisor", "2026-11-20T10:09:00.000Z", { supervisor: true }),
      agent(4, "To-do UI builder", "2026-11-20T10:06:00.000Z"),
      agent(5, "Stray", "2026-11-20T10:07:00.000Z", { projectId: crypto.randomUUID() }),
    ],
  );
  expect(references.map((ref) => ref.label)).toEqual([
    "To-do UI builder",
    "To-do tester",
    "Old test",
    "To-do App",
  ]);
  // An empty `@` lists them in that order; typing narrows without losing it.
  expect(matchReferences(references, "").map((ref) => ref.label)[0]).toBe("To-do UI builder");
  expect(matchReferences(references, "to").map((ref) => ref.label)).toEqual([
    "To-do UI builder",
    "To-do tester",
    "To-do App",
    // Its workspace's name matches, not its own.
    "Old test",
  ]);
});

it("groups closed chats last, folded until opened or a name is typed", () => {
  const references = supervisorReferences(
    { projects: [{ id: project, name: "To-do App" }] as never, closedProjects: [] },
    [
      agent(1, "Closed tester", "2026-11-20T10:09:00.000Z"),
      agent(2, "To-do UI builder", "2026-11-20T10:06:00.000Z"),
      agent(3, "Closed reviewer", "2026-11-20T10:08:00.000Z"),
    ],
  );
  const closed = new Set(
    references.filter((ref) => ref.label.startsWith("Closed")).map((ref) => ref.id),
  );
  const labels = (refs: readonly { label: string }[]) => refs.map((ref) => ref.label);

  const folded = mentionGroups(references, closed, "", null);
  // Open chats and workspaces first, as before; the newer closed chats wait behind the fold.
  expect(labels(folded.open)).toEqual(["To-do UI builder", "To-do App"]);
  expect(folded).toMatchObject({ closed: [], closedOpen: false, closedMatches: 2 });
  expect(labels(folded.rows)).toEqual(["To-do UI builder", "To-do App"]);

  const unfolded = mentionGroups(references, closed, "", true);
  expect(labels(unfolded.rows)).toEqual([
    "To-do UI builder",
    "To-do App",
    "Closed tester",
    "Closed reviewer",
  ]);

  // A typed name reaches into the fold without opening it, and still lists closed chats last.
  const typed = mentionGroups(references, closed, "test", null);
  expect(typed.closedOpen).toBe(true);
  expect(labels(typed.rows)).toEqual(["Closed tester"]);
  expect(mentionGroups(references, closed, "test", false).rows).toEqual([]);
  // No closed chat matches: no fold at all.
  expect(mentionGroups(references, closed, "UI", null)).toMatchObject({ closedMatches: 0 });
});
