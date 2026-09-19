import { describe, expect, it } from "vitest";
import type { PullRequestDetail } from "@concors/protocol";
import {
  ageLabel,
  byOpenCount,
  foldersLabel,
  mergeReadiness,
  repositoryLabel,
  rowActions,
} from "./labels";

it("describes pull request ages compactly", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  expect(ageLabel("2026-09-18T11:59:30Z", now)).toBe("just now");
  expect(ageLabel("2026-09-18T11:55:00Z", now)).toBe("5m ago");
  expect(ageLabel("2026-09-18T09:00:00Z", now)).toBe("3h ago");
  expect(ageLabel("2026-09-14T12:00:00Z", now)).toBe("4d ago");
  expect(ageLabel("2026-06-01T12:00:00Z", now)).not.toMatch(/ago|2026/);
  expect(ageLabel("2025-06-01T12:00:00Z", now)).toMatch(/2025/);
  // A clock slightly behind GitHub's is not "in the future".
  expect(ageLabel("2026-09-18T12:00:10Z", now)).toBe("just now");
  expect(ageLabel("not a date", now)).toBe("");
});

it("drops the owner from repository names unless that makes two look alike", () => {
  const names = ["hologramxyz/studio", "hologramxyz/app", "fork/app"];
  expect(repositoryLabel("hologramxyz/studio", names)).toBe("studio");
  expect(repositoryLabel("hologramxyz/app", names)).toBe("hologramxyz/app");
  expect(repositoryLabel("fork/App", ["fork/App", "hologramxyz/app"])).toBe("fork/App");
});

it("orders repositories by open pull requests, then name", () => {
  expect(
    byOpenCount([
      { name: "b", openCount: 0 },
      { name: "c", openCount: 4 },
      { name: "a", openCount: 0 },
    ]).map((repository) => repository.name),
  ).toEqual(["c", "a", "b"]);
});

it("names the child folders holding a repository", () => {
  const name = "hologram/app";
  expect(foldersLabel({ name, folders: [""] })).toBeNull();
  expect(foldersLabel({ name, folders: ["App"] })).toBeNull();
  expect(foldersLabel({ name, folders: ["web"] })).toBe("web");
  expect(foldersLabel({ name, folders: ["app", "app-copy"] })).toBe("app, app-copy");
  expect(foldersLabel({ name, folders: ["a", "b", "c", "d"] })).toBe("a, b +2");
});

describe("mergeReadiness", () => {
  const detail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
    repository: "hologram/app",
    number: 7,
    title: "Ship it",
    url: "https://github.com/hologram/app/pull/7",
    body: "",
    bodyTruncated: false,
    state: "open",
    draft: false,
    author: "octocat",
    mine: false,
    baseBranch: "main",
    headBranch: "ship-it",
    headSha: "a".repeat(40),
    createdAt: "2026-09-18T10:00:00Z",
    updatedAt: "2026-09-18T11:00:00Z",
    commits: 1,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    review: null,
    mergeable: "mergeable",
    mergeState: "clean",
    mergeMethods: ["squash"],
    defaultMergeMethod: "squash",
    canMerge: true,
    canClose: true,
    checks: [{ name: "test", state: "passing" }],
    checkCount: 1,
    labels: [],
    timeline: [],
    commentCount: 0,
    ...overrides,
  });
  const summary = (overrides: Partial<PullRequestDetail>) => {
    const { tone, title, allowed } = mergeReadiness(detail(overrides));
    return [tone, title, allowed];
  };

  it("puts access, drafts and conflicts first, since GitHub always refuses them", () => {
    expect(summary({ canMerge: false, draft: true })).toEqual([
      "blocked",
      "You can't merge this pull request",
      false,
    ]);
    expect(summary({ draft: true, mergeState: "draft" })[2]).toBe(false);
    expect(summary({ mergeable: "conflicting", mergeState: "dirty" })).toEqual([
      "blocked",
      "This branch has conflicts",
      false,
    ]);
  });

  it("leaves blocked, behind and unknown states to GitHub, explaining why", () => {
    expect(summary({ mergeable: "unknown", mergeState: "unknown" })[0]).toBe("pending");
    expect(summary({ mergeState: "behind" })).toEqual([
      "warning",
      "This branch is out of date with main",
      true,
    ]);
    expect(summary({ mergeState: "blocked", review: "review-required" })[1]).toBe(
      "Review required",
    );
    expect(
      summary({ mergeState: "blocked", checks: [{ name: "test", state: "failing" }] })[1],
    ).toBe("Required checks are failing");
    expect(
      summary({ mergeState: "unstable", checks: [{ name: "lint", state: "failing" }] }),
    ).toEqual(["warning", "Some checks are failing", true]);
    expect(summary({})).toEqual(["ready", "Ready to merge", true]);
  });
});

it("offers row actions only where the daemon and the GitHub account allow them", () => {
  const row = (overrides: Partial<Parameters<typeof rowActions>[0]>) =>
    rowActions({ supported: true, permission: "write", draft: false, mine: false, ...overrides });
  // A daemon that only lists pull requests cannot act on them.
  expect(row({ supported: false })).toBeNull();
  expect(row({})).toEqual({ merge: "enabled", close: true });
  expect(row({ draft: true })).toEqual({ merge: "draft", close: true });
  expect(row({ permission: "triage" })).toEqual({ merge: null, close: true });
  expect(row({ permission: "read", mine: true })).toEqual({ merge: null, close: true });
  expect(row({ permission: "read" })).toBeNull();
  // Older daemons do not report access, so GitHub decides.
  expect(row({ permission: undefined })).toEqual({ merge: "enabled", close: true });
});
