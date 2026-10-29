import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { recentlyClosed } from "./closed-workspaces";

const closed = (name: string, n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  directory: `/folders/${n}`,
  closedAt: "2026-10-29T00:00:00.000Z",
});

it("lists the five most recently closed, with the folder only where names clash", () => {
  const workspace = {
    projects: [{ name: "Workspace 1" }],
    closedProjects: [
      closed("Workspace 1", 1),
      closed("app", 2),
      closed("app", 3),
      closed("site", 4),
      closed("docs", 5),
      closed("old", 6),
    ],
  } as unknown as WorkspaceSnapshot;
  expect(recentlyClosed(workspace).map((p) => [p.name, p.clashes])).toEqual([
    ["Workspace 1", true],
    ["app", true],
    ["app", true],
    ["site", false],
    ["docs", false],
  ]);
  expect(recentlyClosed(null)).toEqual([]);
});
