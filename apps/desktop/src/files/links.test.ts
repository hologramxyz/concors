import { describe, expect, it } from "vitest";
import { resolveFileLink } from "./links";
describe("project file links", () => {
  it("resolves agent references and Markdown-relative links with line locations", () => {
    expect(resolveFileLink("README.md:4", "/repo")).toEqual({ path: "README.md", line: 4 });
    expect(resolveFileLink("src/main.ts:42:3", "/repo")).toEqual({ path: "src/main.ts", line: 42 });
    expect(resolveFileLink("/repo/src/main.ts#L9-L12", "/repo")).toEqual({
      path: "src/main.ts",
      line: 9,
    });
    expect(resolveFileLink("file:///repo/my%20file.md", "/repo")).toEqual({ path: "my file.md" });
    expect(resolveFileLink("../README.md", "/repo", "docs/guide.md")).toEqual({
      path: "README.md",
    });
    expect(resolveFileLink("C:\\repo\\src\\main.ts:5", "C:\\repo")).toEqual({
      path: "src/main.ts",
      line: 5,
    });
  });
  it("rejects external URLs and paths outside the project", () => {
    for (const link of [
      "https://example.com/a.ts",
      "javascript:alert(1)",
      "//host/file",
      "file://host/repo/a",
      "/repo-other/a",
      "../secret",
      "%2e%2e/secret",
      "a%00b",
      "#section",
    ])
      expect(resolveFileLink(link, "/repo")).toBeNull();
  });
});
