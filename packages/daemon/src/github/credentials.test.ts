import { expect, it, vi } from "vitest";
import { discoverGitHubToken, GitHubCredentials, type CommandRunner } from "./credentials.ts";

const runner = (outputs: Record<string, string | Error>) => {
  const calls: { command: string; input?: string }[] = [];
  const run: CommandRunner = async (command, _args, input) => {
    calls.push({ command, ...(input === undefined ? {} : { input }) });
    const output = outputs[command];
    if (output === undefined || output instanceof Error) throw output ?? new Error("ENOENT");
    return output;
  };
  return { run, calls };
};

it("prefers environment tokens without running any command", async () => {
  const { run, calls } = runner({ gh: "gho_cli" });
  expect(await discoverGitHubToken({ GITHUB_TOKEN: " ghp_env \n" }, run)).toBe("ghp_env");
  expect(await discoverGitHubToken({ GH_TOKEN: "gh", GITHUB_TOKEN: "github" }, run)).toBe("gh");
  expect(calls).toEqual([]);
});

it("uses the GitHub CLI login, then Git's credential helper for github.com", async () => {
  expect(await discoverGitHubToken({}, runner({ gh: "gho_cli\n" }).run)).toBe("gho_cli");
  const helper = runner({
    gh: new Error("not logged in"),
    git: "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghs_helper\n",
  });
  expect(await discoverGitHubToken({}, helper.run)).toBe("ghs_helper");
  expect(helper.calls).toEqual([
    { command: "gh" },
    { command: "git", input: "protocol=https\nhost=github.com\n\n" },
  ]);
});

it("reports no token when nothing on the machine has one", async () => {
  expect(await discoverGitHubToken({}, runner({ gh: "", git: "username=me\n" }).run)).toBeNull();
  expect(await discoverGitHubToken({}, runner({}).run)).toBeNull();
});

it("caches lookups, shares concurrent ones and looks again after invalidation", async () => {
  const discover = vi.fn(async () => "token");
  const credentials = new GitHubCredentials(discover);
  expect(await Promise.all([credentials.token(), credentials.token()])).toEqual(["token", "token"]);
  await credentials.token();
  expect(discover).toHaveBeenCalledTimes(1);
  credentials.invalidate();
  await credentials.token();
  expect(discover).toHaveBeenCalledTimes(2);
});

it("remembers a missing token only briefly", async () => {
  vi.useFakeTimers();
  try {
    const discover = vi.fn(async () => null);
    const credentials = new GitHubCredentials(discover);
    await credentials.token();
    await credentials.token();
    expect(discover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await credentials.token();
    expect(discover).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
