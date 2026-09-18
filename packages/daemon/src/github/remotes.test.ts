import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHubRepository, parseGitHubRemote, preferredGitHubRemote } from "./remotes.ts";

describe("parseGitHubRemote", () => {
  it.each([
    "https://github.com/concors-dev/concors.git",
    "https://github.com/concors-dev/concors",
    "https://github.com/concors-dev/concors/",
    "http://www.github.com/concors-dev/concors.git",
    "https://x-access-token:secret@github.com/concors-dev/concors.git",
    "git@github.com:concors-dev/concors.git",
    "github.com:concors-dev/concors",
    "ssh://git@github.com/concors-dev/concors.git",
    "ssh://git@github.com:22/concors-dev/concors.git",
    "git://github.com/concors-dev/concors.git",
  ])("recognizes %s", (url) => {
    expect(parseGitHubRemote(url)).toEqual({ owner: "concors-dev", name: "concors" });
  });

  it.each([
    "https://gitlab.com/concors-dev/concors.git",
    "https://github.example.com/concors-dev/concors.git",
    "git@github-work:concors-dev/concors.git",
    "https://github.com/concors-dev",
    "https://github.com/concors-dev/concors/pulls",
    "https://github.com/-bad/concors",
    "https://github.com/concors-dev/..",
    "file:///github.com/concors-dev/concors",
    "/srv/git/concors.git",
    "",
  ])("ignores %s", (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});

describe("preferredGitHubRemote", () => {
  const config = (...lines: string[]) => lines.join("\n");

  it("prefers the gh default, then upstream, github and origin, like the GitHub CLI", () => {
    const remotes = [
      "remote.origin.url git@github.com:me/concors.git",
      "remote.upstream.url https://github.com/concors-dev/concors.git",
      "remote.backup.url https://github.com/backup/concors.git",
    ];
    expect(preferredGitHubRemote(config(...remotes))).toEqual({
      owner: "concors-dev",
      name: "concors",
    });
    expect(preferredGitHubRemote(config(...remotes, "remote.backup.gh-resolved base"))).toEqual({
      owner: "backup",
      name: "concors",
    });
    expect(preferredGitHubRemote(config(remotes[0]!, remotes[2]!))).toEqual({
      owner: "me",
      name: "concors",
    });
  });

  it("skips remotes that are not on GitHub and handles dotted remote names", () => {
    expect(
      preferredGitHubRemote(
        config(
          "remote.origin.url https://gitlab.com/me/concors.git",
          "remote.my.fork.url git@github.com:me/concors.git",
        ),
      ),
    ).toEqual({ owner: "me", name: "concors" });
    expect(preferredGitHubRemote("")).toBeNull();
  });
});

it("reads a checkout's remotes and treats a repository without them as unmatched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-remotes-"));
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", directory, ...args]);
    git("init", "--quiet");
    expect(await gitHubRepository(directory)).toBeNull();
    git("remote", "add", "origin", "git@github.com:concors-dev/concors.git");
    expect(await gitHubRepository(directory)).toEqual({ owner: "concors-dev", name: "concors" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
