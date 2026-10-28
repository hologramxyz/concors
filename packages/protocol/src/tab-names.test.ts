import { expect, it } from "vitest";
import { nextWorkspaceName, nextWorkspaceTabName } from "./tab-names.ts";
import { isUntitledChat } from "./agents.ts";

const tabs = (...names: string[]) => names.map((name) => ({ name }));
it("numbers new tabs within each workspace, independently of pane type", () => {
  expect(nextWorkspaceTabName([])).toBe("Tab 1");
  expect(nextWorkspaceTabName(tabs("Tab 1"))).toBe("Tab 2");
  expect(nextWorkspaceTabName(tabs("Tab 1", "Tab 2"))).toBe("Tab 3");
  expect(nextWorkspaceTabName([])).toBe("Tab 1");
});
it("counts renamed and legacy tabs without changing them", () => {
  const existing = tabs("Build and review", "Terminal", "Claude Code");
  expect(nextWorkspaceTabName(existing)).toBe("Tab 4");
  expect(existing).toEqual(tabs("Build and review", "Terminal", "Claude Code"));
});
it("avoids collisions after closing, moving, or manually numbering tabs", () => {
  expect(nextWorkspaceTabName(tabs("Tab 3", "Tab 1"))).toBe("Tab 4");
  expect(nextWorkspaceTabName(tabs("tab 5", "Notes"))).toBe("Tab 6");
  expect(nextWorkspaceTabName(tabs("Tab 20", "Tab 2"))).toBe("Tab 21");
});
it("ignores non-numeric and unsafe-number custom labels", () => {
  expect(
    nextWorkspaceTabName(tabs("Tab Infinity", "Tab 9999999999999999999999", "Tab 2 notes")),
  ).toBe("Tab 4");
  expect(
    nextWorkspaceTabName(
      tabs(`Tab ${Number.MAX_SAFE_INTEGER - 1}`, `Tab ${Number.MAX_SAFE_INTEGER}`),
    ),
  ).toBe("Tab 3");
});
it("numbers one-click workspaces with the lowest number not in use", () => {
  const projects = (...names: string[]) => names.map((name) => ({ name }));
  expect(nextWorkspaceName([])).toBe("Workspace 1");
  expect(nextWorkspaceName(projects("Workspace 1", "studio"))).toBe("Workspace 2");
  expect(nextWorkspaceName(projects("Workspace 2", "workspace 1"))).toBe("Workspace 3");
  expect(nextWorkspaceName(projects("Workspace 2", "Workspace"))).toBe("Workspace 1");
});
it("treats a chat as untitled under its new name or its provider's, never once titled", () => {
  expect(isUntitledChat({ name: "New chat", provider: "claude" })).toBe(true);
  expect(isUntitledChat({ name: "Claude Code", provider: "claude" })).toBe(true);
  expect(isUntitledChat({ name: "Codex", provider: "codex", providerLabel: "Codex" })).toBe(true);
  expect(isUntitledChat({ name: "hello?", provider: "claude" })).toBe(false);
});
