import { expect, it } from "vitest";
import { nextWorkspaceTabName } from "./tab-names.ts";

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
