import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { supervisorReferences } from "./reference-context";
import { matchReferences } from "./reference-text";

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
