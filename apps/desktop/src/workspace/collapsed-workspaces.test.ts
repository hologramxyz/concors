import { beforeEach, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

/** The module as a fresh launch of the app finds it. */
async function launch() {
  vi.resetModules();
  return import("./collapsed-workspaces");
}

beforeEach(() => stored.clear());

it("keeps folds in localStorage, under the same key and format, when no storage is given", async () => {
  const folds = await launch();
  folds.setWorkspaceExpanded("a", false);
  folds.setWorkspaceExpanded("b", false);
  expect(stored.get(folds.COLLAPSED_WORKSPACES_KEY)).toBe('["a","b"]');
  folds.setWorkspaceExpanded("a", true);
  expect(stored.get(folds.COLLAPSED_WORKSPACES_KEY)).toBe('["b"]');
  // A later launch finds them.
  (await launch()).setWorkspaceExpanded("b", true);
  expect(stored.get(folds.COLLAPSED_WORKSPACES_KEY)).toBe("[]");
});

it("reads and writes a given storage instead, leaving localStorage alone", async () => {
  const folds = await launch();
  let ids: readonly string[] = ["kept"];
  const write = vi.fn((next: readonly string[]) => {
    ids = next;
  });
  folds.setCollapsedWorkspacesStorage({ read: () => ids, write });
  folds.setWorkspaceExpanded("new", false);
  expect(write).toHaveBeenLastCalledWith(["kept", "new"]);
  // What it holds is what the store starts from: unfolding one it already had folded.
  folds.setWorkspaceExpanded("kept", true);
  expect(write).toHaveBeenLastCalledWith(["new"]);
  expect(stored.size).toBe(0);
  // Without it again, localStorage is used as before.
  folds.setCollapsedWorkspacesStorage(null);
  folds.setWorkspaceExpanded("other", false);
  expect(stored.get(folds.COLLAPSED_WORKSPACES_KEY)).toBe('["other"]');
});
