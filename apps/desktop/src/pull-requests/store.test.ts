import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type {
  PullRequestResult,
  WorkspacePullRequests,
  WorkspaceSnapshot,
} from "@concors/protocol";
import {
  PullRequestStore,
  pullRequestKey,
  totalOpenCount,
  unavailablePullRequests,
  workspaceOpenCount,
} from "./store";

const project = {
  id: crypto.randomUUID(),
  directory: "/hologram",
  name: "H",
  tabs: [],
  version: 0,
};
const workspace: WorkspaceSnapshot = {
  schemaVersion: 1,
  machineId: crypto.randomUUID(),
  epoch: crypto.randomUUID(),
  revision: 0,
  selection: null,
  projects: [project],
};
const repository = (name: string, openCount: number) => ({
  name,
  url: `https://github.com/${name}`,
  folders: [name.split("/")[1] ?? ""],
  openCount,
  pullRequests: [],
  error: null,
});
const listing = (repositories = [repository("hologram/app", 2)]): WorkspacePullRequests => ({
  projectId: project.id,
  directory: project.directory,
  repositories,
});
const listed = (workspaces = [listing()]): PullRequestResult => ({
  type: "pull-request.result",
  requestId: crypto.randomUUID(),
  outcome: { status: "listed", viewer: "octocat", fetchedAt: 1, workspaces },
});
function setup(capabilities = ["workspace-pull-requests"]) {
  const connection = {
    state: {
      status: "ready",
      daemon: { protocolVersion: "v1", daemonVersion: "0.4.0", status: "ready", capabilities },
    } as DaemonConnection["state"],
    workspace,
    requestPullRequests: vi
      .fn<DaemonConnection["requestPullRequests"]>()
      .mockResolvedValue(listed()),
  };
  return { connection, store: new PullRequestStore(connection) };
}
afterEach(() => vi.restoreAllMocks());

it("counts each workspace's repositories, and shared repositories once overall", () => {
  const folder = listing([repository("hologram/app", 2), repository("hologram/site", 3)]);
  const checkout = { ...listing([repository("Hologram/App", 2)]), projectId: crypto.randomUUID() };
  expect(workspaceOpenCount(folder)).toBe(5);
  expect(workspaceOpenCount(undefined)).toBe(0);
  expect(totalOpenCount([folder, checkout])).toBe(5);
});

it("lists every workspace in one request and reuses it for a minute", async () => {
  const { store, connection } = setup();
  store.refresh(workspace);
  store.refresh(workspace);
  await vi.waitFor(() => expect(store.getSnapshot().status).toBe("listed"));
  expect(connection.requestPullRequests).toHaveBeenCalledTimes(1);
  expect(connection.requestPullRequests.mock.calls[0]?.[0]).toEqual({
    kind: "list",
    epoch: workspace.epoch,
    projects: [{ projectId: project.id, directory: "/hologram" }],
  });
  expect(
    workspaceOpenCount(
      store.getSnapshot().workspaces.get(pullRequestKey(workspace.epoch, project)),
    ),
  ).toBe(2);
  store.refresh(workspace);
  expect(connection.requestPullRequests).toHaveBeenCalledTimes(1);
  // An explicit refresh asks the daemon to skip its cache.
  store.refresh(workspace, true);
  expect(connection.requestPullRequests.mock.calls[1]?.[0]).toMatchObject({ refresh: true });
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
  await vi.waitFor(() => expect(store.getSnapshot().refreshing).toBe(false));
  vi.spyOn(Date, "now").mockReturnValue(now + 125_000);
  store.refresh(workspace);
  expect(connection.requestPullRequests).toHaveBeenCalledTimes(3);
});

it("keeps the last listing when a refresh fails and drops replies for an old layout", async () => {
  const { store, connection } = setup();
  store.refresh(workspace);
  await vi.waitFor(() => expect(store.getSnapshot().status).toBe("listed"));
  connection.requestPullRequests.mockRejectedValueOnce(new Error("Connection lost."));
  store.refresh(workspace, true);
  await vi.waitFor(() => expect(store.getSnapshot().message).toBe("Connection lost."));
  expect(store.getSnapshot()).toMatchObject({ status: "listed", refreshing: false });
  expect(store.getSnapshot().workspaces.size).toBe(1);

  let finish!: (result: PullRequestResult) => void;
  connection.requestPullRequests.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  store.refresh(workspace, true);
  const moved = { ...workspace, projects: [{ ...project, directory: "/hologram/app" }] };
  connection.requestPullRequests.mockResolvedValueOnce(
    listed([{ ...listing(), directory: "/hologram/app" }]),
  );
  store.refresh(moved);
  // The old folder's counts vanish immediately, and its late reply is ignored.
  expect(store.getSnapshot().workspaces.size).toBe(0);
  await vi.waitFor(() => expect(store.getSnapshot().refreshing).toBe(false));
  finish(listed());
  await Promise.resolve();
  expect([...store.getSnapshot().workspaces.keys()]).toEqual([
    pullRequestKey(workspace.epoch, moved.projects[0]!),
  ]);
});

it("reports signed-out machines and never asks an older daemon", async () => {
  const { store, connection } = setup();
  connection.requestPullRequests.mockResolvedValueOnce({
    type: "pull-request.result",
    requestId: crypto.randomUUID(),
    outcome: { status: "signed-out", message: "Run gh auth login." },
  });
  store.refresh(workspace);
  await vi.waitFor(() =>
    expect(store.getSnapshot()).toMatchObject({
      status: "signed-out",
      message: "Run gh auth login.",
    }),
  );
  const older = setup([]);
  older.store.refresh(workspace);
  expect(older.connection.requestPullRequests).not.toHaveBeenCalled();
  expect(older.store.getSnapshot()).toBe(unavailablePullRequests);
});

it("lists merged pull requests separately, only from daemons that support them", async () => {
  const { connection } = setup(["workspace-pull-requests", "pull-request-states"]);
  const merged = new PullRequestStore(connection, "merged");
  merged.refresh(workspace);
  await vi.waitFor(() => expect(merged.getSnapshot().status).toBe("listed"));
  expect(connection.requestPullRequests.mock.calls[0]?.[0]).toMatchObject({ state: "merged" });
  const older = setup();
  const history = new PullRequestStore(older.connection, "closed");
  history.refresh(workspace);
  expect(older.connection.requestPullRequests).not.toHaveBeenCalled();
  expect(history.getSnapshot()).toBe(unavailablePullRequests);
});
it("keeps the listing through a reconnect and asks again once the workspace is back", async () => {
  const { store, connection } = setup();
  store.refresh(workspace);
  await vi.waitFor(() => expect(store.getSnapshot().status).toBe("listed"));
  const ready = connection.state;
  let cutOff!: (cause: Error) => void;
  connection.requestPullRequests.mockReturnValueOnce(
    new Promise((_, reject) => {
      cutOff = reject;
    }),
  );
  store.refresh(workspace, true);
  Object.assign(connection, { state: { status: "disconnected" }, workspace: null });
  store.refresh(workspace);
  cutOff(new Error("Connection lost"));
  await Promise.resolve();
  expect(store.getSnapshot()).toMatchObject({ status: "listed", message: null, refreshing: false });
  Object.assign(connection, { state: ready, workspace });
  store.refresh(workspace);
  expect(connection.requestPullRequests).toHaveBeenCalledTimes(3);
});
