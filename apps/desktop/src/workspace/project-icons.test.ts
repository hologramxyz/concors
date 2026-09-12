import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type { FileResult, WorkspaceSnapshot } from "@concors/protocol";
import { ProjectIconCache, projectIconKey } from "./project-icons";
const project = { id: crypto.randomUUID(), directory: "/repo", name: "Repo", tabs: [], version: 0 };
const workspace: WorkspaceSnapshot = {
  schemaVersion: 1,
  machineId: crypto.randomUUID(),
  epoch: crypto.randomUUID(),
  revision: 0,
  selection: null,
  projects: [project],
};
const result: FileResult = {
  type: "file.result",
  requestId: crypto.randomUUID(),
  outcome: { status: "project-icon", icon: { isGit: true, source: null } },
};
function setup() {
  const connection = {
    state: {
      status: "ready",
      daemon: {
        protocolVersion: "v1",
        daemonVersion: "0.3.0",
        status: "ready",
        capabilities: ["project-icons"],
      },
    } as DaemonConnection["state"],
    requestFile: vi.fn<DaemonConnection["requestFile"]>().mockResolvedValue(result),
  };
  return { connection, cache: new ProjectIconCache(connection) };
}
afterEach(() => vi.restoreAllMocks());
it("reuses icons across renders and refreshes changed files after a minute", async () => {
  const { cache, connection } = setup();
  cache.refresh(workspace);
  cache.refresh(workspace);
  await vi.waitFor(() => expect(cache.getSnapshot().size).toBe(1));
  cache.refresh({ ...workspace, revision: 5 });
  expect(connection.requestFile).toHaveBeenCalledTimes(1);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  connection.requestFile.mockResolvedValue({
    ...result,
    outcome: { status: "project-icon", icon: { isGit: false, source: null } },
  });
  cache.refresh(workspace);
  await vi.waitFor(() =>
    expect(cache.getSnapshot().get(projectIconKey(workspace.epoch, project))?.isGit).toBe(false),
  );
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
});
it("drops replies for a previous directory or workspace epoch", async () => {
  const { cache, connection } = setup();
  let finish!: (value: FileResult) => void;
  connection.requestFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  cache.refresh(workspace);
  const next = {
    ...workspace,
    epoch: crypto.randomUUID(),
    projects: [{ ...project, directory: "/other" }],
  };
  cache.refresh(next);
  await vi.waitFor(() => expect(cache.getSnapshot().size).toBe(1));
  finish(result);
  await Promise.resolve();
  expect([...cache.getSnapshot().keys()]).toEqual([projectIconKey(next.epoch, next.projects[0]!)]);
});
it("keeps a known icon when refresh fails and retries after backoff", async () => {
  const { cache, connection } = setup();
  cache.refresh(workspace);
  await vi.waitFor(() => expect(cache.getSnapshot().size).toBe(1));
  let now = Date.now() + 61000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  connection.requestFile.mockRejectedValue(new Error("Disconnected"));
  cache.refresh(workspace);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.refresh(workspace);
  expect(connection.requestFile).toHaveBeenCalledTimes(2);
  expect(cache.getSnapshot().size).toBe(1);
  now += 11000;
  cache.refresh(workspace);
  expect(connection.requestFile).toHaveBeenCalledTimes(3);
});
it("does not send unsupported requests and ignores replies after disconnect", async () => {
  const { cache, connection } = setup();
  let finish!: (value: FileResult) => void;
  connection.requestFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  cache.refresh(workspace);
  connection.state = { status: "disconnected" };
  cache.refresh(workspace);
  finish(result);
  await Promise.resolve();
  expect(cache.getSnapshot().size).toBe(0);
  connection.state = {
    status: "ready",
    daemon: { protocolVersion: "v1", daemonVersion: "0.2.0", status: "ready", capabilities: [] },
  };
  cache.refresh(workspace);
  expect(connection.requestFile).toHaveBeenCalledTimes(1);
});
