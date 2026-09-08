import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  chmodSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import type { ProjectRequest } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { ProjectManager, validateRepository } from "./manager.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "concors-projects-"));
  const store = new WorkspaceStore(join(root, "state.sqlite"));
  const manager = new ProjectManager(store, () => undefined, root);
  cleanups.push(() => {
    manager.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const request = (
    mode: "open" | "create" | "clone",
    directory: string,
    repository = "",
  ): ProjectRequest => ({
    type: "project.request",
    requestId: randomUUID(),
    operation: {
      kind: "start",
      epoch: store.snapshot().epoch,
      id: randomUUID(),
      mode,
      name: "Project",
      directory,
      repository,
    },
  });
  return { root, store, manager, request };
}
it("opens and creates real folders, preserving duplicate receipts and existing files", async () => {
  const { root, store, manager, request } = fixture();
  const target = join(root, "new-project");
  const create = request("create", target);
  expect(manager.request(create).outcome.status).toBe("ok");
  await expect.poll(() => store.projectSetups()[0]?.status).toBe("done");
  writeFileSync(join(target, "keep.txt"), "preserve me");
  expect(manager.request(create).outcome.status).toBe("ok");
  expect(store.snapshot().projects).toHaveLength(1);
  if (create.operation.kind !== "start") throw new Error();
  expect(
    manager.request({
      ...create,
      operation: { ...create.operation, id: randomUUID(), directory: join(root, "other") },
    }).outcome.status,
  ).toBe("error");

  expect(manager.request({ ...create, requestId: randomUUID() }).outcome).toMatchObject({
    status: "error",
  });
  manager.request(request("create", target));
  await expect.poll(() => store.projectSetups()[1]?.status).toBe("failed");
  expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("preserve me");
  const existing = join(root, "existing");
  mkdirSync(existing);
  manager.request(request("open", existing));
  await expect.poll(() => store.projectSetups()[2]?.status).toBe("done");
  expect(store.snapshot().projects).toHaveLength(2);
  for (const project of store.snapshot().projects) {
    expect(project.tabs).toHaveLength(1);
    expect(project.tabs[0]).toMatchObject({
      name: "Terminal",
      nodes: [{ kind: "pane", profile: "shell", sessionId: null }],
    });
  }
  const selectedProject = store.snapshot().projects[1]!;
  expect(store.snapshot().selection).toEqual({
    projectId: selectedProject.id,
    tabId: selectedProject.tabs[0]!.id,
  });
  manager.request(request("open", join(root, "missing")));
  await expect.poll(() => store.projectSetups()[3]?.status).toBe("failed");
  expect(store.snapshot().projects).toHaveLength(2);
});
it("clones a real Git repository and registers it only after checkout succeeds", async () => {
  const { root, store, manager, request } = fixture();
  const source = join(root, "source");
  mkdirSync(source);
  execFileSync("git", ["init", source]);
  writeFileSync(join(source, "README.md"), "real checked out content");
  execFileSync("git", ["-C", source, "add", "README.md"]);
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=Concors Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "Fixture",
  ]);
  const destination = join(root, "clone");
  manager.request(request("clone", destination, source));
  expect(store.snapshot().projects).toHaveLength(0);
  await expect.poll(() => store.projectSetups()[0]?.status, { timeout: 5000 }).toBe("done");
  expect(readFileSync(join(destination, "README.md"), "utf8")).toBe("real checked out content");
  expect(store.snapshot().projects[0]?.directory).toContain("clone");
  manager.request(request("clone", join(root, "failed-clone"), join(root, "missing-repo")));
  await expect.poll(() => store.projectSetups()[1]?.status, { timeout: 5000 }).toBe("failed");
  expect(store.snapshot().projects).toHaveLength(1);
});
it("cancels setup without creating a usable project and recovers interrupted receipts", async () => {
  const { root, store, manager, request } = fixture();
  const start = request("create", join(root, "cancelled"));
  manager.request(start);
  manager.request({
    type: "project.request",
    requestId: randomUUID(),
    operation: { kind: "cancel", id: start.operation.kind === "start" ? start.operation.id : "" },
  });
  await expect.poll(() => store.projectSetups()[0]?.status).toBe("cancelled");
  expect(store.snapshot().projects).toHaveLength(0);
  const interrupted = request("create", join(root, "interrupted"));
  if (interrupted.operation.kind !== "start") throw new Error();
  store.reserveProjectSetup(interrupted, {
    ...interrupted.operation,
    status: "working",
    progress: "Preparing",
  });
  manager.close();
  const recovered = new ProjectManager(store, () => undefined);
  expect(recovered.request(interrupted).outcome.status).toBe("ok");
  expect(store.projectSetups()[1]?.status).toBe("interrupted");
  expect(existsSync(join(root, "interrupted"))).toBe(false);
  recovered.close();
});
it("rejects command-like URLs and embedded credentials", () => {
  for (const repository of [
    "--upload-pack=evil",
    "ext::sh -c evil",
    "https://user:secret@github.com/org/repo",
    "file:relative",
    "git://example.com/repo",
  ])
    expect(() => validateRepository(repository)).toThrow();
  for (const repository of [
    "https://github.com/org/repo.git",
    "git@github.com:org/repo.git",
    "ssh://git@github.com/org/repo.git",
  ])
    expect(() => validateRepository(repository)).not.toThrow();
});

it("creates repos automatically and resolves simple names and tilde on the daemon", async () => {
  const { root, store, manager, request } = fixture();
  manager.request(request("create", "first-project"));
  await expect.poll(() => store.projectSetups()[0]?.status).toBe("done");
  expect(existsSync(join(root, "repos", "first-project"))).toBe(true);
  expect(store.snapshot().projects[0]?.directory).toBe(
    await realpath(join(root, "repos", "first-project")),
  );
  manager.request(request("create", "~/repos/second-project"));
  await expect.poll(() => store.projectSetups()[1]?.status).toBe("done");
  expect(existsSync(join(root, "repos", "second-project"))).toBe(true);
  const existing = join(root, "repos", "existing");
  mkdirSync(existing);
  manager.request(request("open", "existing"));
  await expect.poll(() => store.projectSetups()[2]?.status).toBe("done");
  expect(manager.request(request("create", "../outside")).outcome.status).toBe("error");
  expect(existsSync(join(root, "outside"))).toBe(false);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "explains real permission failures without claiming destination files were created",
  async () => {
    const { root, store, manager, request } = fixture();
    const protectedParent = join(root, "protected");
    mkdirSync(protectedParent);
    chmodSync(protectedParent, 0o500);
    try {
      manager.request(request("create", join(protectedParent, "test")));
      await expect.poll(() => store.projectSetups()[0]?.status).toBe("failed");
      expect(store.projectSetups()[0]?.progress).toContain("default ~/repos");
      expect(store.projectSetups()[0]?.progress).not.toContain("preserved");
      expect(existsSync(join(protectedParent, "test"))).toBe(false);
    } finally {
      chmodSync(protectedParent, 0o700);
    }
  },
);
