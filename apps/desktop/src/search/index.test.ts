import { expect, it } from "vitest";
import type { AgentInfo, WorkspaceProject } from "@concors/protocol";
import { matchScore, searchEntries, workspaceEntries } from "./index";

const project: WorkspaceProject = {
  id: "p",
  name: "Hologram",
  directory: "/repos/hologram",
  version: 1,
  tabs: [
    {
      id: "t",
      name: "Backend review",
      root: "split",
      nodes: [
        {
          kind: "pane",
          id: "shell",
          profile: "shell",
          sessionId: "terminal",
          directory: "/repos/api",
        },
        {
          kind: "split",
          id: "split",
          first: "chat",
          second: "shell",
          axis: "horizontal",
          ratio: 0.5,
        },
        { kind: "pane", id: "chat", profile: "chat", sessionId: "agent" },
      ],
    },
  ],
};
const agent: AgentInfo = {
  id: "agent",
  projectId: "p",
  provider: "codex",
  providerLabel: "Codex",
  name: "Investigate checkout",
  directory: "/repos/api",
  model: "fixture-model",
  threadId: null,
  turnId: null,
  status: "idle",
  error: null,
  startedAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
  turnStartedAt: null,
  revision: 0,
  pending: [],
  attention: null,
};

it("indexes exact pane targets in display order without rewriting the desktop layout", () => {
  const before = structuredClone(project);
  const entries = workspaceEntries([project], [agent]);
  expect(entries.map((entry) => [entry.kind, entry.title, entry.target?.paneId])).toEqual([
    ["workspace", "Hologram", undefined],
    ["pane", "Backend review · 1", "chat"],
    ["pane", "Backend review · 2", "shell"],
  ]);
  expect(entries[1]?.target).toEqual({ projectId: "p", tabId: "t", paneId: "chat" });
  expect(project).toEqual(before);
});

it("finds agent names, providers, models and each pane's own working directory", () => {
  const entries = workspaceEntries([project], [agent]);
  for (const query of ["checkout", "CoDeX hologram", "fixture-model", "api investigate"])
    expect(searchEntries(entries, query, "all").map((entry) => entry.target?.paneId)).toEqual([
      "chat",
    ]);
  expect(
    searchEntries(entries, "api terminal", "tabs").map((entry) => entry.target?.paneId),
  ).toEqual(["shell"]);
});

it("keeps same-named workspaces and tabs distinct with stable identifiers and path context", () => {
  const second = { ...project, id: "other", directory: "/repos/another" };
  const entries = workspaceEntries([project, second], []);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  const matches = searchEntries(entries, "Hologram", "workspaces");
  expect(matches.map((entry) => entry.detail)).toEqual(["/repos/hologram", "/repos/another"]);
  expect(searchEntries(entries, "another", "workspaces")[0]?.projectId).toBe("other");
});

it("matches accent-insensitive terms in any order, but requires every term", () => {
  expect(matchScore(" CAFE build ", "Build Café", "/repo")).toBeGreaterThan(0);
  expect(matchScore("API café", "Café", "/repos/api")).toBeGreaterThan(0);
  expect(matchScore("API missing", "Café", "/repos/api")).toBe(0);
  expect(matchScore("[api]", "Fix [api]")).toBeGreaterThan(0);
});

it("ranks exact names ahead of path matches, then prefers the active workspace", () => {
  const entries = workspaceEntries(
    [
      { ...project, id: "a", name: "Other", directory: "/Backend review", tabs: [] },
      { ...project, id: "b", name: "Backend review", tabs: [] },
    ],
    [],
  );
  expect(searchEntries(entries, "backend review", "workspaces", "a")[0]?.projectId).toBe("b");
  expect(searchEntries(entries, "", "all", "b")[0]?.projectId).toBe("b");
});

it("filters categories and omits detached or wrong-project agent metadata", () => {
  const entries = workspaceEntries(
    [project],
    [
      { ...agent, projectId: "other" },
      { ...agent, id: "detached" },
    ],
  );
  expect(searchEntries(entries, "checkout", "all")).toEqual([]);
  expect(searchEntries(entries, "", "workspaces")).toHaveLength(1);
  expect(searchEntries(entries, "", "tabs")).toHaveLength(2);
  expect(searchEntries(entries, "", "commands")).toEqual([]);
  expect(workspaceEntries([], [agent])).toEqual([]);
});

it("uses new snapshots for renames/removals rather than retaining old results", () => {
  const original = workspaceEntries([project], [agent]);
  expect(searchEntries(original, "checkout", "tabs")).toHaveLength(1);
  const updated = workspaceEntries([{ ...project, tabs: [] }], [agent]);
  expect(searchEntries(updated, "checkout", "tabs")).toEqual([]);
  expect(
    searchEntries(
      workspaceEntries([{ ...project, name: "Renamed", tabs: [] }], []),
      "Renamed",
      "workspaces",
    ),
  ).toHaveLength(1);
});

it("does not mutate the index when filtering or ranking", () => {
  const entries = workspaceEntries([project], [agent]);
  const before = structuredClone(entries);
  searchEntries(entries, "terminal", "tabs");
  searchEntries(entries, "", "all", "other");
  expect(entries).toEqual(before);
});
