import type { DaemonConnection } from "@concors/daemon-client";
import {
  PULL_REQUESTS_CAPABILITY,
  PULL_REQUEST_STATES_CAPABILITY,
  type PullRequestState as ListedState,
  type WorkspacePullRequests,
  type WorkspaceProject,
  type WorkspaceSnapshot,
} from "@concors/protocol";

/**
 * Open pull requests for every workspace on the connected machine, shared by the sidebar and the
 * Pull requests page. One request covers all workspaces; the daemon owns GitHub access and its
 * own per-repository cache, so this only decides when to ask. A failed refresh keeps the last
 * listing, and a reply for another machine state or folder layout is dropped. Open pull requests
 * are what the sidebar counts; merged and closed ones have their own stores, loaded only when
 * someone looks at them.
 */
export const pullRequestKey = (
  epoch: string,
  project: Pick<WorkspaceProject, "id" | "directory">,
) => JSON.stringify([epoch, project.id, project.directory]);

export interface PullRequestState {
  /** `unavailable`: disconnected, or the daemon predates pull requests. */
  readonly status: "unavailable" | "loading" | "listed" | "signed-out" | "error";
  /** Why pull requests are missing or stale. */
  readonly message: string | null;
  readonly viewer: string | null;
  readonly fetchedAt: number | null;
  readonly refreshing: boolean;
  readonly workspaces: ReadonlyMap<string, WorkspacePullRequests>;
}

export const unavailablePullRequests: PullRequestState = {
  status: "unavailable",
  message: null,
  viewer: null,
  fetchedAt: null,
  refreshing: false,
  workspaces: new Map(),
};

export function workspaceOpenCount(listing: WorkspacePullRequests | undefined): number {
  return listing?.repositories.reduce((sum, repository) => sum + repository.openCount, 0) ?? 0;
}

/** Workspaces can share a repository (a folder and one of its checkouts): count it once. */
export function totalOpenCount(workspaces: Iterable<WorkspacePullRequests>): number {
  const repositories = new Map<string, number>();
  for (const workspace of workspaces)
    for (const repository of workspace.repositories)
      repositories.set(repository.name.toLowerCase(), repository.openCount);
  let total = 0;
  for (const count of repositories.values()) total += count;
  return total;
}

const LISTED_TTL_MS = 60_000;
/** Signing in or a GitHub outage should clear soon after it is fixed. */
const RETRY_TTL_MS = 20_000;

export class PullRequestStore {
  #connection: Pick<DaemonConnection, "state" | "requestPullRequests">;
  #state: PullRequestState = unavailablePullRequests;
  #listeners = new Set<() => void>();
  #pending: { keys: string } | null = null;
  #settled: { keys: string; expires: number } | null = null;
  readonly state: ListedState;
  constructor(
    connection: Pick<DaemonConnection, "state" | "requestPullRequests">,
    state: ListedState = "open",
  ) {
    this.#connection = connection;
    this.state = state;
  }
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(state: PullRequestState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  /** The next refresh asks again, even within a minute of the last listing. */
  invalidate() {
    this.#settled = null;
  }

  refresh(workspace: WorkspaceSnapshot, force = false) {
    const capabilities =
      this.#connection.state.status === "ready" ? this.#connection.state.daemon.capabilities : [];
    if (
      !capabilities?.includes(PULL_REQUESTS_CAPABILITY) ||
      (this.state !== "open" && !capabilities.includes(PULL_REQUEST_STATES_CAPABILITY))
    ) {
      this.#pending = null;
      this.#settled = null;
      if (this.#state !== unavailablePullRequests) this.#publish(unavailablePullRequests);
      return;
    }
    const current = workspace.projects.map((project) => pullRequestKey(workspace.epoch, project));
    const keys = JSON.stringify(current);
    if (this.#pending?.keys === keys && !force) return;
    if (!force && this.#settled?.keys === keys && this.#settled.expires > Date.now()) return;
    const request = { keys };
    this.#pending = request;
    // Closed or moved workspaces disappear at once rather than after the reply.
    const retained = new Map([...this.#state.workspaces].filter(([key]) => current.includes(key)));
    this.#publish({
      ...this.#state,
      status: this.#state.status === "unavailable" ? "loading" : this.#state.status,
      refreshing: true,
      workspaces: retained,
    });
    const settle = (state: Omit<PullRequestState, "refreshing">, ttl: number) => {
      if (this.#pending !== request) return;
      this.#pending = null;
      this.#settled = { keys, expires: Date.now() + ttl };
      this.#publish({ ...state, refreshing: false });
    };
    const fail = (message: string) =>
      settle(
        this.#state.status === "listed"
          ? { ...this.#state, message }
          : { ...unavailablePullRequests, status: "error", message },
        RETRY_TTL_MS,
      );
    this.#connection
      .requestPullRequests(
        {
          kind: "list",
          epoch: workspace.epoch,
          projects: workspace.projects.map((project) => ({
            projectId: project.id,
            directory: project.directory,
          })),
          ...(force ? { refresh: true } : {}),
          ...(this.state === "open" ? {} : { state: this.state }),
        },
        crypto.randomUUID(),
      )
      .then(({ outcome }) => {
        if (outcome.status === "listed")
          settle(
            {
              status: "listed",
              message: null,
              viewer: outcome.viewer,
              fetchedAt: outcome.fetchedAt,
              workspaces: new Map(
                outcome.workspaces.map((listing) => [
                  pullRequestKey(workspace.epoch, {
                    id: listing.projectId,
                    directory: listing.directory,
                  }),
                  listing,
                ]),
              ),
            },
            LISTED_TTL_MS,
          );
        else if (outcome.status === "signed-out")
          settle(
            { ...unavailablePullRequests, status: "signed-out", message: outcome.message },
            RETRY_TTL_MS,
          );
        else
          fail(outcome.status === "error" ? outcome.message : "Unexpected reply from the machine.");
      })
      .catch((cause: unknown) =>
        fail(cause instanceof Error ? cause.message : "Could not load pull requests."),
      );
  }
}

const stores = new WeakMap<DaemonConnection, Map<ListedState, PullRequestStore>>();
export function pullRequestStore(connection: DaemonConnection, state: ListedState = "open") {
  let byState = stores.get(connection);
  if (!byState) {
    byState = new Map();
    stores.set(connection, byState);
  }
  let store = byState.get(state);
  if (!store) {
    store = new PullRequestStore(connection, state);
    byState.set(state, store);
  }
  return store;
}

/** After a merge, close or comment, every state's listing is out of date. */
export function invalidatePullRequests(connection: DaemonConnection) {
  for (const store of stores.get(connection)?.values() ?? []) store.invalidate();
}
