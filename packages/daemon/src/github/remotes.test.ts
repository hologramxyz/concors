import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHubRepository, parseGitHubRemote, preferredGitHubRemote } from "./remotes.ts";

describe("parseGitHubRemote", () => {
  it.each([
    "https://github.com/hologramxyz/concors.git",
    "https://github.com/hologramxyz/concors",
    "https://github.com/hologramxyz/concors/",
    "http://www.github.com/hologramxyz/concors.git",
    "https://x-access-token:secret@github.com/hologramxyz/concors.git",
    "git@github.com:hologramxyz/concors.git",
    "github.com:hologramxyz/concors",
    "ssh://git@github.com/hologramxyz/concors.git",
    "ssh://git@github.com:22/hologramxyz/concors.git",
    "git://github.com/hologramxyz/concors.git",
  ])("recognizes %s", (url) => {
    expect(parseGitHubRemote(url)).toEqual({ owner: "hologramxyz", name: "concors" });
  });

  it.each([
    "https://gitlab.com/hologramxyz/concors.git",
    "https://github.example.com/hologramxyz/concors.git",
    "git@github-work:hologramxyz/concors.git",
    "https://github.com/hologramxyz",
    "https://github.com/hologramxyz/concors/pulls",
    "https://github.com/-bad/concors",
    "https://github.com/hologramxyz/..",
    "file:///github.com/hologramxyz/concors",
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
      "remote.upstream.url https://github.com/hologramxyz/concors.git",
      "remote.backup.url https://github.com/backup/concors.git",
    ];
    expect(preferredGitHubRemote(config(...remotes))).toEqual({
      owner: "hologramxyz",
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
    git("remote", "add", "origin", "git@github.com:hologramxyz/concors.git");
    expect(await gitHubRepository(directory)).toEqual({ owner: "hologramxyz", name: "concors" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
