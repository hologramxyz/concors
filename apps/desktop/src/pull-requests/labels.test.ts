import { expect, it } from "vitest";
import { ageLabel, byOpenCount, foldersLabel, repositoryLabel } from "./labels";

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
