import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type {
  PullRequestState,
  MergeMethod,
  PullRequestOperation,
  PullRequestRepository,
  PullRequestRequest,
  PullRequestResult,
  WorkspacePullRequests as WorkspaceListing,
} from "@concors/protocol";
import { GitHubCredentials } from "../github/credentials.ts";
import {
  fetchPullRequests,
  GitHubAuthError,
  type PullRequestListing,
  type RepositoryPullRequests,
} from "../github/pull-requests.ts";
import { gitHubRepository, repositoryKey, type GitHubRepository } from "../github/remotes.ts";
import { fetchPullRequestDetail, type PullRequestRecord } from "../github/pull-request-detail.ts";
import {
  closePullRequest,
  commentOnPullRequest,
  mergePullRequest,
} from "../github/pull-request-actions.ts";
import type { WorkspaceStore } from "../workspace/store.ts";
import { childRepositories, workTreeRoot } from "./repositories.ts";

/**
 * Open pull requests for the GitHub repositories in each workspace.
 *
 * A workspace inside a repository has that one repository; an ordinary folder has its direct
 * child repositories, one level deep, the same rule its icon follows. Several checkouts of one
 * repository count it once. Results are cached per repository for a minute, so every client and
 * every workspace sharing a repository costs GitHub one lookup.
 */
export interface WorkspaceCheckout {
  /** "" for the workspace folder itself, otherwise the child folder's name. */
  readonly folder: string;
  readonly repository: GitHubRepository;
}

export async function workspaceCheckouts(root: string): Promise<WorkspaceCheckout[]> {
  const top = await workTreeRoot(root);
  const folders = top ? [""] : await childRepositories(root);
  const checkouts = await Promise.all(
    folders.map(async (folder) => {
      const repository = await gitHubRepository(folder ? join(root, folder) : (top ?? root));
      return repository ? [{ folder, repository }] : [];
    }),
  );
  return checkouts.flat();
}

const CACHE_TTL_MS = 60_000;
/** An explicit refresh still reuses a result this fresh, so repeated clicks cost nothing. */
const REFRESH_FLOOR_MS = 5_000;
const MAX_REPOSITORIES = 90;
const SIGNED_OUT =
  "Sign in to GitHub on this machine to see pull requests: run `gh auth login`, or set GH_TOKEN.";
const REJECTED =
  "GitHub rejected this machine's credentials. Sign in again with `gh auth login`, or update GH_TOKEN.";

type Fetcher = (
  token: string,
  repositories: readonly GitHubRepository[],
  state: PullRequestState,
) => Promise<PullRequestListing>;
/** One pull request on GitHub: read it, merge, close or comment by node ID. */
export interface PullRequestApi {
  readonly detail: (
    token: string,
    repository: GitHubRepository,
    number: number,
  ) => Promise<PullRequestRecord>;
  readonly merge: (
    token: string,
    id: string,
    method: MergeMethod,
    expectedHeadSha: string,
  ) => Promise<void>;
  readonly close: (token: string, id: string) => Promise<void>;
  readonly comment: (token: string, id: string, body: string) => Promise<void>;
}
const gitHubPullRequests: PullRequestApi = {
  detail: (token, repository, number) => fetchPullRequestDetail(token, repository, number),
  merge: (token, id, method, head) => mergePullRequest(token, id, method, head),
  close: (token, id) => closePullRequest(token, id),
  comment: (token, id, body) => commentOnPullRequest(token, id, body),
};
/** Replaces the machine's GitHub token and api.github.com, for isolated acceptance tests. */
export interface GitHubSource {
  readonly token: () => Promise<string | null>;
  readonly fetch: Fetcher;
  readonly pullRequest?: PullRequestApi;
}
type Outcome = PullRequestResult["outcome"];
type Action = Exclude<PullRequestOperation, { kind: "list" }>;

export class WorkspacePullRequests {
  #workspace: WorkspaceStore;
  #credentials: GitHubCredentials;
  #fetch: Fetcher;
  #api: PullRequestApi;
  #cache = new Map<
    string,
    { fetchedAt: number; result: Promise<RepositoryPullRequests & { viewer: string | null }> }
  >();
  constructor(
    workspace: WorkspaceStore,
    credentials = new GitHubCredentials(),
    fetcher: Fetcher = (token, repositories, state) =>
      fetchPullRequests(token, repositories, fetch, state),
    api: PullRequestApi = gitHubPullRequests,
  ) {
    this.#workspace = workspace;
    this.#credentials = credentials;
    this.#fetch = fetcher;
    this.#api = api;
  }

  async request(request: PullRequestRequest): Promise<PullRequestResult> {
    const reply = (outcome: PullRequestResult["outcome"]): PullRequestResult => ({
      type: "pull-request.result",
      requestId: request.requestId,
      outcome,
    });
    const operation = request.operation;
    try {
      if (this.#workspace.snapshot().epoch !== operation.epoch)
        throw new Error("Machine state changed. Reconnect before loading pull requests.");
      const token = await this.#credentials.token();
      if (!token) return reply({ status: "signed-out", message: SIGNED_OUT });
      return reply(
        operation.kind === "list"
          ? await this.#list(
              operation.projects,
              operation.refresh ?? false,
              token,
              operation.state ?? "open",
            )
          : await this.#act(operation, token),
      );
    } catch (error) {
      if (error instanceof GitHubAuthError) {
        this.#credentials.invalidate();
        return reply({ status: "signed-out", message: REJECTED });
      }
      return reply({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load pull requests.",
      });
    }
  }

  /** Detail, merge, close or comment, only for a repository that belongs to the workspace. */
  async #act(operation: Action, token: string): Promise<Outcome> {
    const root = await realpath(
      this.#workspace.fileDirectory(operation.projectId, operation.directory),
    );
    const repository = (await workspaceCheckouts(root)).find(
      (checkout) => repositoryKey(checkout.repository) === operation.repository.toLowerCase(),
    )?.repository;
    if (!repository) throw new Error("This repository is no longer part of the workspace.");
    const current = await this.#api.detail(token, repository, operation.number);
    if (operation.kind === "detail") return { status: "detail", detail: current.detail };
    const { detail } = current;
    if (operation.kind !== "comment" && detail.state !== "open")
      throw new Error(`This pull request is already ${detail.state}.`);
    let action: "merged" | "closed" | "commented";
    if (operation.kind === "merge") {
      if (!detail.canMerge)
        throw new Error("This machine's GitHub account cannot merge into this repository.");
      if (!detail.mergeMethods.includes(operation.method))
        throw new Error("This repository does not allow that merge method.");
      await this.#api.merge(token, current.id, operation.method, operation.expectedHeadSha);
      action = "merged";
    } else if (operation.kind === "close") {
      if (!detail.canClose)
        throw new Error("This machine's GitHub account cannot close this pull request.");
      if (operation.comment) await this.#api.comment(token, current.id, operation.comment);
      await this.#api.close(token, current.id);
      action = "closed";
    } else {
      await this.#api.comment(token, current.id, operation.body);
      action = "commented";
    }
    // Counts change at once rather than after the minute-long cache expires.
    for (const state of ["open", "merged", "closed"])
      this.#cache.delete(`${state}:${repositoryKey(repository)}`);
    const after = await this.#api.detail(token, repository, operation.number);
    return { status: "updated", action, detail: after.detail };
  }

  async #list(
    projects: { projectId: string; directory?: string | undefined }[],
    refresh: boolean,
    token: string,
    state: PullRequestState,
  ): Promise<Outcome> {
    const workspaces = (
      await Promise.all(
        projects.map(async ({ projectId, directory }) => {
          try {
            const requested = this.#workspace.fileDirectory(projectId, directory);
            return [
              {
                projectId,
                directory: requested,
                checkouts: await workspaceCheckouts(await realpath(requested)),
              },
            ];
          } catch {
            // A closed workspace or missing folder has nothing to list.
            return [];
          }
        }),
      )
    ).flat();
    const unique = new Map<string, GitHubRepository>();
    for (const { checkouts } of workspaces)
      for (const { repository } of checkouts) unique.set(repositoryKey(repository), repository);
    const results = await this.#load([...unique].slice(0, MAX_REPOSITORIES), token, refresh, state);
    let viewer: string | null = null;
    const listings: WorkspaceListing[] = workspaces.map(({ projectId, directory, checkouts }) => {
      const repositories = new Map<string, PullRequestRepository>();
      for (const { folder, repository } of checkouts) {
        const key = repositoryKey(repository);
        const existing = repositories.get(key);
        if (existing) {
          existing.folders.push(folder);
          continue;
        }
        const result = results.get(key);
        viewer ??= result?.viewer ?? null;
        repositories.set(key, {
          name: result?.name ?? `${repository.owner}/${repository.name}`,
          url: result?.url ?? `https://github.com/${repository.owner}/${repository.name}`,
          folders: [folder],
          openCount: result?.openCount ?? 0,
          pullRequests: result?.pullRequests ?? [],
          error: result ? result.error : "Not loaded: too many repositories in open workspaces.",
          permission: result?.permission ?? null,
        });
      }
      return { projectId, directory, repositories: [...repositories.values()] };
    });
    return { status: "listed", viewer, fetchedAt: Date.now(), state, workspaces: listings };
  }

  /** Cached per state and repository, so each listing of a repository costs GitHub one lookup. */
  async #load(
    listed: [string, GitHubRepository][],
    token: string,
    refresh: boolean,
    state: PullRequestState,
  ) {
    const repositories = listed.map(
      ([key, repository]) => [`${state}:${key}`, repository] as [string, GitHubRepository],
    );
    const now = Date.now();
    for (const [key, entry] of this.#cache)
      if (now - entry.fetchedAt > CACHE_TTL_MS) this.#cache.delete(key);
    const results = new Map<string, Promise<RepositoryPullRequests & { viewer: string | null }>>();
    const stale: [string, GitHubRepository][] = [];
    for (const [key, repository] of repositories) {
      const cached = this.#cache.get(key);
      if (cached && now - cached.fetchedAt <= (refresh ? REFRESH_FLOOR_MS : CACHE_TTL_MS))
        results.set(key, cached.result);
      else stale.push([key, repository]);
    }
    if (stale.length) {
      const batch = this.#fetch(
        token,
        stale.map(([, repository]) => repository),
        state,
      );
      stale.forEach(([key], index) => {
        const entry = {
          fetchedAt: now,
          result: batch.then(({ viewer, repositories: listed }) => {
            const result = listed[index];
            if (!result) throw new Error("GitHub returned an incomplete listing.");
            return { ...result, viewer };
          }),
        };
        this.#cache.set(key, entry);
        results.set(key, entry.result);
        // Failures are reported to this request and retried by the next one, never cached.
        entry.result.catch(() => {
          if (this.#cache.get(key) === entry) this.#cache.delete(key);
        });
      });
    }
    return new Map(
      await Promise.all(
        [...results].map(
          async ([key, result]) => [key.slice(state.length + 1), await result] as const,
        ),
      ),
    );
  }
}
