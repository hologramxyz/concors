import { describe, expect, it } from "vitest";

import { defaultCloneDirectory } from "./clone-directory.ts";

describe("default clone directory", () => {
  it("groups a selected GitHub repository under its owner", () => {
    expect(defaultCloneDirectory("opserai/opser")).toBe("~/repos/opserai/opser");
  });

  it("preserves the owner for common GitHub URL formats", () => {
    expect(defaultCloneDirectory("https://github.com/opserai/opser.git")).toBe(
      "~/repos/opserai/opser",
    );
    expect(defaultCloneDirectory("git@github.com:opserai/opser.git")).toBe("~/repos/opserai/opser");
    expect(defaultCloneDirectory("ssh://git@github.com/opserai/opser.git")).toBe(
      "~/repos/opserai/opser",
    );
  });

  it("keeps local paths and other remotes as a single repository folder", () => {
    expect(defaultCloneDirectory("/home/pier/projects/opser")).toBe("~/repos/opser");
    expect(defaultCloneDirectory("https://git.example.com/opserai/opser.git")).toBe(
      "~/repos/opser",
    );
  });

  it("sanitizes suggested folders and never suggests traversal segments", () => {
    expect(defaultCloneDirectory("my team/my repo.git")).toBe("~/repos/my-team/my-repo");
    expect(defaultCloneDirectory("../repo")).toBe("~/repos/repo");
  });
});
