import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PullRequestResultSchema, type PullRequestResult } from "@concors/protocol";
import { GitHubCredentials } from "../github/credentials.ts";
import { GitHubAuthError, type PullRequestListing } from "../github/pull-requests.ts";
import type { GitHubRepository } from "../github/remotes.ts";
import { WorkspaceStore } from "../workspace/store.ts";
import { WorkspacePullRequests, workspaceCheckouts } from "./pull-requests.ts";

let directory: string, store: WorkspaceStore;
const repository = (path: string, remote?: string) => {
  execFileSync("git", ["init", "--quiet", path]);
  if (remote) execFileSync("git", ["-C", path, "remote", "add", "origin", remote]);
};
const addProject = (name: string, folder: string) => {
  const projectId = randomUUID();
  store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: store.snapshot().epoch,
    operation: { kind: "project.add", projectId, name, directory: folder },
  });
  return projectId;
};
const listing = (repositories: readonly GitHubRepository[]): PullRequestListing => ({
  viewer: "octocat",
  repositories: repositories.map(({ owner, name }) => ({
    name: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    openCount: name.length,
    pullRequests: [],
    error: null,
  })),
});
const list = async (
  service: WorkspacePullRequests,
  projects: { projectId: string }[],
  refresh = false,
) => {
  const result = await service.request({
    type: "pull-request.request",
    requestId: randomUUID(),
    operation: { kind: "list", epoch: store.snapshot().epoch, projects, refresh },
  });
  expect(PullRequestResultSchema.safeParse(result).success).toBe(true);
  return result.outcome;
};
const listed = (outcome: PullRequestResult["outcome"]) => {
  if (outcome.status !== "listed") throw new Error(`Expected a listing, got ${outcome.status}`);
  return outcome;
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "concors-pull-requests-"));
  store = new WorkspaceStore();
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

it("finds a workspace's own repository, or its direct child repositories on GitHub", async () => {
  const folder = join(directory, "hologram");
  repository(join(folder, "app"), "git@github.com:hologram/app.git");
  repository(join(folder, "app-copy"), "https://github.com/hologram/app.git");
  repository(join(folder, "gitlab"), "https://gitlab.com/hologram/gitlab.git");
  repository(join(folder, "local"));
  await mkdir(join(folder, "plain"));
  repository(join(folder, "plain", "nested"), "https://github.com/hologram/nested.git");
  expect(await workspaceCheckouts(folder)).toEqual([
    { folder: "app", repository: { owner: "hologram", name: "app" } },
    { folder: "app-copy", repository: { owner: "hologram", name: "app" } },
  ]);
  // Inside a repository, the repository is the workspace; its children are not searched.
  await mkdir(join(folder, "app", "src"));
  expect(await workspaceCheckouts(join(folder, "app", "src"))).toEqual([
    { folder: "", repository: { owner: "hologram", name: "app" } },
  ]);
  expect(await workspaceCheckouts(directory)).toEqual([]);
});

it("groups checkouts by repository and fetches each repository once for every workspace", async () => {
  const folder = join(directory, "hologram");
  repository(join(folder, "app"), "git@github.com:hologram/app.git");
  repository(join(folder, "app-copy"), "https://github.com/hologram/app.git");
  repository(join(folder, "site"), "https://github.com/hologram/site.git");
  const hologram = addProject("Hologram", folder);
  const app = addProject("App", join(folder, "app"));
  const plain = addProject("Plain", directory);
  const fetcher = vi.fn(async (_token: string, repositories: readonly GitHubRepository[]) =>
    listing(repositories),
  );
  const service = new WorkspacePullRequests(
    store,
    new GitHubCredentials(async () => "token"),
    fetcher,
  );
  const outcome = listed(
    await list(service, [{ projectId: hologram }, { projectId: app }, { projectId: plain }]),
  );
  expect(outcome.viewer).toBe("octocat");
  expect(outcome.workspaces).toEqual([
    {
      projectId: hologram,
      directory: folder,
      repositories: [
        expect.objectContaining({ name: "hologram/app", folders: ["app", "app-copy"] }),
        expect.objectContaining({ name: "hologram/site", folders: ["site"], openCount: 4 }),
      ],
    },
    {
      projectId: app,
      directory: join(folder, "app"),
      repositories: [expect.objectContaining({ name: "hologram/app", folders: [""] })],
    },
    { projectId: plain, directory, repositories: [] },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]).toHaveLength(2);
  // Cached for every later request, including an explicit refresh moments later.
  await list(service, [{ projectId: app }]);
  await list(service, [{ projectId: hologram }], true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not cache failures", async () => {
  const folder = join(directory, "app");
  repository(folder, "https://github.com/hologram/app.git");
  const projectId = addProject("App", folder);
  const fetcher = vi
    .fn<(token: string, repositories: readonly GitHubRepository[]) => Promise<PullRequestListing>>()
    .mockRejectedValueOnce(new Error("GitHub is unavailable (HTTP 502)."))
    .mockImplementation(async (_token, repositories) => listing(repositories));
  const service = new WorkspacePullRequests(
    store,
    new GitHubCredentials(async () => "token"),
    fetcher,
  );
  expect(await list(service, [{ projectId }])).toEqual({
    status: "error",
    message: "GitHub is unavailable (HTTP 502).",
  });
  expect(listed(await list(service, [{ projectId }])).workspaces[0]?.repositories).toHaveLength(1);
});

it("asks the user to sign in when the machine has no token or GitHub rejects it", async () => {
  const projectId = addProject("Folder", directory);
  const fetcher = vi.fn(async () => listing([]));
  const signedOut = new WorkspacePullRequests(
    store,
    new GitHubCredentials(async () => null),
    fetcher,
  );
  expect(await list(signedOut, [{ projectId }])).toMatchObject({ status: "signed-out" });
  expect(fetcher).not.toHaveBeenCalled();

  repository(join(directory, "app"), "https://github.com/hologram/app.git");
  const discover = vi.fn(async () => "expired");
  const rejected = new WorkspacePullRequests(store, new GitHubCredentials(discover), async () => {
    throw new GitHubAuthError("rejected");
  });
  expect(await list(rejected, [{ projectId }])).toMatchObject({
    status: "signed-out",
    message: expect.stringContaining("rejected"),
  });
  await list(rejected, [{ projectId }]);
  expect(discover).toHaveBeenCalledTimes(2);
});

it("rejects a stale epoch and skips workspaces that were closed", async () => {
  const service = new WorkspacePullRequests(store, new GitHubCredentials(async () => "token"));
  const result = await service.request({
    type: "pull-request.request",
    requestId: randomUUID(),
    operation: { kind: "list", epoch: randomUUID(), projects: [] },
  });
  expect(result.outcome).toMatchObject({ status: "error" });
  expect(listed(await list(service, [{ projectId: randomUUID() }])).workspaces).toEqual([]);
});
