import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PullRequestResultSchema,
  type PullRequestDetail,
  type PullRequestRequest,
  type PullRequestResult,
} from "@concors/protocol";
import { GitHubCredentials } from "../github/credentials.ts";
import { GitHubAuthError, type PullRequestListing } from "../github/pull-requests.ts";
import type { GitHubRepository } from "../github/remotes.ts";
import { WorkspaceStore } from "../workspace/store.ts";
import { WorkspacePullRequests, workspaceCheckouts, type PullRequestApi } from "./pull-requests.ts";

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

it("caches each state separately and clears every state after an action", async () => {
  const folder = join(directory, "app");
  repository(folder, "https://github.com/hologram/app.git");
  const projectId = addProject("App", folder);
  const fetcher = vi.fn(
    async (_token: string, repositories: readonly GitHubRepository[], _state: string) =>
      listing(repositories),
  );
  const service = new WorkspacePullRequests(
    store,
    new GitHubCredentials(async () => "token"),
    fetcher,
  );
  const request = async (state?: "merged") => {
    const result = await service.request({
      type: "pull-request.request",
      requestId: randomUUID(),
      operation: {
        kind: "list",
        epoch: store.snapshot().epoch,
        projects: [{ projectId }],
        ...(state ? { state } : {}),
      },
    });
    return listed(result.outcome);
  };
  expect((await request()).state).toBe("open");
  expect((await request("merged")).state).toBe("merged");
  await request();
  await request("merged");
  expect(fetcher.mock.calls.map((call) => call[2])).toEqual(["open", "merged"]);
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

describe("pull request actions", () => {
  const head = "a".repeat(40);
  const detail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
    repository: "hologram/app",
    number: 7,
    title: "Ship it",
    url: "https://github.com/hologram/app/pull/7",
    body: "",
    bodyTruncated: false,
    state: "open",
    draft: false,
    author: "octocat",
    mine: false,
    baseBranch: "main",
    headBranch: "ship-it",
    headSha: head,
    createdAt: "2026-09-18T10:00:00Z",
    updatedAt: "2026-09-18T11:00:00Z",
    commits: 1,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    review: null,
    mergeable: "mergeable",
    mergeState: "clean",
    mergeMethods: ["squash", "merge"],
    defaultMergeMethod: "squash",
    canMerge: true,
    canClose: true,
    checks: [],
    checkCount: 0,
    labels: [],
    timeline: [],
    commentCount: 0,
    ...overrides,
  });
  function setup(initial: Partial<PullRequestDetail> = {}) {
    const folder = join(directory, "hologram");
    repository(join(folder, "app"), "git@github.com:hologram/app.git");
    const projectId = addProject("Hologram", folder);
    let current = detail(initial);
    const calls: string[] = [];
    const api: PullRequestApi = {
      detail: vi.fn(async () => ({ id: "PR_7", detail: current })),
      merge: vi.fn(async (_token, id, method, expected) => {
        calls.push(`merge ${id} ${method} ${expected === head}`);
        current = { ...current, state: "merged" };
      }),
      close: vi.fn(async (_token, id) => {
        calls.push(`close ${id}`);
        current = { ...current, state: "closed" };
      }),
      comment: vi.fn(async (_token, id, body) => {
        calls.push(`comment ${id} ${body}`);
        current = { ...current, commentCount: current.commentCount + 1 };
      }),
    };
    const fetcher = vi.fn(async (_token: string, repositories: readonly GitHubRepository[]) =>
      listing(repositories),
    );
    const service = new WorkspacePullRequests(
      store,
      new GitHubCredentials(async () => "token"),
      fetcher,
      api,
    );
    const act = async (operation: Record<string, unknown>) => {
      const result = await service.request({
        type: "pull-request.request",
        requestId: randomUUID(),
        operation: {
          epoch: store.snapshot().epoch,
          projectId,
          repository: "hologram/app",
          number: 7,
          ...operation,
        } as PullRequestRequest["operation"],
      });
      expect(PullRequestResultSchema.safeParse(result).success).toBe(true);
      return result.outcome;
    };
    return { service, act, calls, fetcher, projectId, api };
  }

  it("reads, merges with the reviewed head and refreshes the workspace's counts", async () => {
    const { service, act, calls, fetcher, projectId } = setup();
    expect(await act({ kind: "detail" })).toMatchObject({
      status: "detail",
      detail: { number: 7 },
    });
    await list(service, [{ projectId }]);
    expect(await act({ kind: "merge", method: "squash", expectedHeadSha: head })).toMatchObject({
      status: "updated",
      action: "merged",
      detail: { state: "merged" },
    });
    expect(calls).toEqual(["merge PR_7 squash true"]);
    await list(service, [{ projectId }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await act({ kind: "close" })).toEqual({
      status: "error",
      message: "This pull request is already merged.",
    });
  });

  it("posts a closing comment before closing, and comments on its own", async () => {
    const { act, calls } = setup();
    expect(await act({ kind: "comment", body: "Looks good" })).toMatchObject({
      action: "commented",
      detail: { commentCount: 1 },
    });
    expect(await act({ kind: "close", comment: "Superseded by #8" })).toMatchObject({
      action: "closed",
      detail: { state: "closed" },
    });
    expect(calls).toEqual([
      "comment PR_7 Looks good",
      "comment PR_7 Superseded by #8",
      "close PR_7",
    ]);
  });

  /** The read before the change works; the read back afterwards fails. */
  const failReadBack = (api: PullRequestApi) => {
    const read = vi.mocked(api.detail).getMockImplementation();
    let reads = 0;
    vi.mocked(api.detail).mockImplementation(async (...args) => {
      if (++reads === 2 || !read) throw new Error("GitHub is unavailable (HTTP 502).");
      return read(...args);
    });
  };

  it("reports a change that succeeded even when reading it back fails", async () => {
    const { act, calls, api } = setup();
    failReadBack(api);
    expect(await act({ kind: "merge", method: "squash", expectedHeadSha: head })).toMatchObject({
      status: "updated",
      action: "merged",
      detail: { state: "merged" },
    });
    expect(calls).toEqual(["merge PR_7 squash true"]);
  });

  it("does not repeat a closing comment when the read back fails", async () => {
    const { act, calls, api } = setup();
    failReadBack(api);
    expect(await act({ kind: "close", comment: "Superseded" })).toMatchObject({
      status: "updated",
      action: "closed",
      detail: { state: "closed" },
    });
    expect(calls).toEqual(["comment PR_7 Superseded", "close PR_7"]);
  });

  it("refuses what the account cannot do, disallowed methods and other repositories", async () => {
    const { act, calls } = setup({ canMerge: false, canClose: false, mergeMethods: ["merge"] });
    expect(await act({ kind: "merge", method: "merge", expectedHeadSha: head })).toMatchObject({
      status: "error",
      message: expect.stringContaining("cannot merge"),
    });
    expect(await act({ kind: "close" })).toMatchObject({
      message: expect.stringContaining("cannot close"),
    });
    expect(await act({ kind: "detail", repository: "someone/else" })).toMatchObject({
      status: "error",
      message: "This repository is no longer part of the workspace.",
    });
    expect(calls).toEqual([]);
  });
});
