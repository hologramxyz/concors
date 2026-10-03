import { randomUUID as id } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { WorkspaceOperation } from "@concors/protocol";
import { WorkspaceStore } from "./store.ts";
import { ProjectFiles } from "../files/service.ts";

it("follows only the original shell and saves open files to their original folder after reconnect", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "concors-follow-"));
  const root = await realpath(temporary),
    first = join(root, "first"),
    second = join(root, "second");
  await mkdir(first);
  await mkdir(second);
  await writeFile(join(first, "same.txt"), "original");
  await writeFile(join(second, "same.txt"), "other folder");
  const database = join(root, "workspace.sqlite");
  let store = new WorkspaceStore(database);
  try {
    const epoch = store.snapshot().epoch,
      projectId = id(),
      tabId = id(),
      paneId = id();
    const run = (operation: WorkspaceOperation) => {
      const result = store.execute({
        type: "workspace.command",
        commandId: id(),
        epoch,
        operation,
      });
      expect(result.result.outcome.status).toBe("accepted");
    };
    run({
      kind: "project.add",
      projectId,
      name: "first",
      directory: first,
      directoryMode: "follow",
    });
    run({
      kind: "tab.create",
      projectId,
      expectedVersion: 0,
      tabId,
      paneId,
      name: "Shell",
      profile: "shell",
    });
    const sessionId = id();
    store.reserveTerminal(
      {
        type: "terminal.request",
        requestId: id(),
        operation: {
          kind: "start",
          epoch,
          projectId,
          tabId,
          paneId,
          expectedVersion: 1,
          expectedSessionId: null,
          cols: 80,
          rows: 24,
        },
      },
      {
        id: sessionId,
        projectId,
        profile: "shell",
        directory: first,
        status: "running",
        exitCode: null,
        error: null,
        startedAt: new Date().toISOString(),
        cols: 80,
        rows: 24,
      },
    );
    const files = new ProjectFiles(store);
    const target = { projectId, epoch, path: "same.txt", directory: first };
    const loaded = (
      await files.request({
        type: "file.request",
        requestId: id(),
        operation: { kind: "read", ...target },
      })
    ).outcome;
    if (loaded.status !== "read") throw new Error("File did not load");
    expect(store.observeDirectory(sessionId, second, second)).toBe(true);
    expect(store.snapshot().projects[0]).toMatchObject({
      name: "second",
      directory: second,
      version: 1,
      followPaneId: paneId,
    });
    expect(store.terminal(sessionId).directory).toBe(first);
    // Neither the session start nor directory observations may invalidate a layout command.
    run({ kind: "tab.rename", projectId, tabId, expectedVersion: 1, name: "Still running" });
    store.close();
    store = new WorkspaceStore(database);
    expect(
      (
        await new ProjectFiles(store).request({
          type: "file.request",
          requestId: id(),
          operation: {
            kind: "write",
            ...target,
            content: "saved draft",
            expectedRevision: loaded.file.revision,
          },
        })
      ).outcome.status,
    ).toBe("written");
    expect(await readFile(join(first, "same.txt"), "utf8")).toBe("saved draft");
    expect(await readFile(join(second, "same.txt"), "utf8")).toBe("other folder");
    expect(() => store.fileDirectory(projectId, root)).toThrow("does not belong");
    if (process.platform !== "win32") {
      const whitespaceFolder = join(root, "   ");
      await mkdir(whitespaceFolder);
      store.observeDirectory(sessionId, whitespaceFolder, whitespaceFolder);
      expect(store.snapshot().projects[0]).toMatchObject({
        name: "Workspace",
        directory: whitespaceFolder,
      });
      store.observeDirectory(sessionId, second, second);
    }
    store.observeDirectory(sessionId, first, first);
    expect(store.snapshot().projects[0]).toMatchObject({
      directory: first,
      name: "first",
      directoryMode: "follow",
    });
    expect(store.observeDirectory(id(), root, root)).toBe(false);
  } finally {
    store.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
