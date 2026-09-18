import { expect, it } from "vitest";
import { ageLabel, foldersLabel } from "./labels";

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

it("names the child folders holding a repository", () => {
  expect(foldersLabel({ folders: [""] })).toBeNull();
  expect(foldersLabel({ folders: ["app"] })).toBe("app");
  expect(foldersLabel({ folders: ["app", "app-copy"] })).toBe("app, app-copy");
  expect(foldersLabel({ folders: ["a", "b", "c", "d"] })).toBe("a, b +2");
});
