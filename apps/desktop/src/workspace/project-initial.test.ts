import { expect, it } from "vitest";
import { projectInitial } from "./project-initial";

it("uses the first letter without leaking the full workspace name", () => {
  expect(projectInitial("concors")).toBe("C");
  expect(projectInitial("  build tools  ")).toBe("B");
  expect(projectInitial("東京")).toBe("東");
});

it("keeps grapheme clusters intact and handles empty labels", () => {
  expect(projectInitial("👩🏽‍💻 tools")).toBe("👩🏽‍💻");
  expect(projectInitial("e\u0301clair")).toBe("E\u0301");
  expect(projectInitial(" ")).toBe("?");
});
