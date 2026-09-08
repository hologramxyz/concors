import { expect, it } from "vitest";
import { repositoryImage } from "./repository-image";
it("recognizes HTTPS and SSH GitHub clones without leaking credentials or contacting arbitrary hosts", () => {
  for (const input of [
    "https://github.com/concors-dev/concors.git",
    "git@github.com:concors-dev/concors.git",
    "ssh://git@github.com/concors-dev/concors",
    "https://github.com/concors-dev/concors/",
  ])
    expect(repositoryImage(input)).toBe("https://opengraph.githubassets.com/1/concors-dev/concors");
  for (const input of [
    "/tmp/repository",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://token@github.com/owner/repo",
    "https://github.com/owner/repo?token=secret",
    "https://github.com/owner/..",
    "https://github.com/owner/repo/issues",
  ])
    expect(repositoryImage(input)).toBeNull();
});
