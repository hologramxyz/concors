import { expect, it } from "vitest";
import { withPath } from "./environment.ts";

it("leaves Windows a single PATH, whatever the inherited spelling", () => {
  const inherited = { Path: "C:\\Windows", path: "C:\\stale", HOME: "C:\\Users\\me" };
  expect(withPath(inherited, "C:\\bin;C:\\Windows", "win32")).toEqual({
    HOME: "C:\\Users\\me",
    PATH: "C:\\bin;C:\\Windows",
  });
  // The input is not changed; callers often pass process.env itself.
  expect(inherited.Path).toBe("C:\\Windows");
});

it("only sets PATH where variable names are case-sensitive", () => {
  expect(withPath({ PATH: "/usr/bin", Path: "other" }, "/opt/bin:/usr/bin", "linux")).toEqual({
    PATH: "/opt/bin:/usr/bin",
    Path: "other",
  });
});
