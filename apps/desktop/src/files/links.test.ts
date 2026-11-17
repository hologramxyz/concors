import { describe, expect, it } from "vitest";
import { resolveFileLink, workspaceFileLink } from "./links";
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
describe("workspace file links", () => {
  const projects = [
    { id: "app", directory: "/work/app" },
    { id: "docs", directory: "/work/app/docs" },
    { id: "api", directory: "C:\\work\\api" },
    { id: "empty", directory: "" },
  ];
  const owner = (href: string) => {
    const found = workspaceFileLink(href, projects);
    return found && { id: found.project.id, ...found.location };
  };
  it("opens an absolute link in the innermost open workspace that holds it", () => {
    expect(owner("/work/app/src/main.ts:2")).toEqual({ id: "app", path: "src/main.ts", line: 2 });
    expect(owner("/work/app/docs/guide.md")).toEqual({ id: "docs", path: "guide.md" });
    expect(owner("file:///work/app/my%20notes.md")).toEqual({ id: "app", path: "my notes.md" });
    expect(owner("C:\\work\\api\\server.ts")).toEqual({ id: "api", path: "server.ts" });
  });
  it("leaves relative links and paths no open workspace holds unlinked", () => {
    for (const href of [
      "README.md",
      "src/main.ts",
      "./notes/plan.md",
      "/tmp/shot.png",
      "/work/application/a.ts",
      "//host/work/app/a.ts",
      "https://example.com/work/app/a.ts",
    ])
      expect(owner(href)).toBeNull();
  });
});
