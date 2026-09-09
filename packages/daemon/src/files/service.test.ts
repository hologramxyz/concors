import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES, type FileOperation } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { ProjectFiles } from "./service.ts";

describe("project files", () => {
  let directory: string, root: string, workspace: WorkspaceStore, files: ProjectFiles;
  let projectId: string, epoch: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "concors-files-"));
    root = join(directory, "project");
    await mkdir(root);
    workspace = new WorkspaceStore();
    files = new ProjectFiles(workspace);
    projectId = randomUUID();
    epoch = workspace.snapshot().epoch;
    workspace.execute({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch,
      operation: { kind: "project.add", projectId, directory: root, name: "Files" },
    });
    await writeFile(join(root, "hello.ts"), "export const hello = 1;\n", { mode: 0o755 });
  });
  afterEach(async () => {
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (operation: FileOperation) =>
    (await files.request({ type: "file.request", requestId: randomUUID(), operation })).outcome;
  const read = () => request({ kind: "read", projectId, epoch, path: "hello.ts" });

  it("lists project folders, including dotfiles, and reads text", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, ".env"), "EXAMPLE=demo");
    const result = await request({ kind: "list", projectId, epoch, path: "" });
    expect(result.status).toBe("listed");
    if (result.status !== "listed") throw Error("list");
    expect(result.entries[0]).toMatchObject({ name: "src", kind: "directory" });
    expect(result.entries.some((e) => e.name === ".env")).toBe(true);
    expect(await read()).toMatchObject({
      status: "read",
      file: { content: "export const hello = 1;\n" },
    });
  });
  it("saves atomically, preserves executable permissions, and accepts an acknowledged-lost retry", async () => {
    const initial = await read();
    if (initial.status !== "read") throw Error("read");
    const operation: FileOperation = {
      kind: "write",
      projectId,
      epoch,
      path: "hello.ts",
      expectedRevision: initial.file.revision,
      content: "changed\n",
    };
    expect((await request(operation)).status).toBe("written");
    expect((await request(operation)).status).toBe("written");
    expect(await readFile(join(root, "hello.ts"), "utf8")).toBe("changed\n");
    if (process.platform !== "win32")
      expect((await stat(join(root, "hello.ts"))).mode & 0o777).toBe(0o755);
  });
  it("rejects stale edits from another client or agent and preserves disk content", async () => {
    const initial = await read();
    if (initial.status !== "read") throw Error("read");
    const operation: FileOperation = {
      kind: "write",
      projectId,
      epoch,
      path: "hello.ts",
      expectedRevision: initial.file.revision,
      content: "client one",
    };
    const results = await Promise.all([
      request(operation),
      request({ ...operation, content: "client two" }),
    ]);
    // Path resolution is asynchronous, so either request can reach the write queue first.
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "written"]);
    const winningContent = results[0].status === "written" ? "client one" : "client two";
    const written = results.find((result) => result.status === "written");
    expect(written).toMatchObject({ file: { content: winningContent } });
    expect(await readFile(join(root, "hello.ts"), "utf8")).toBe(winningContent);
    await writeFile(join(root, "hello.ts"), "agent update");
    expect((await request(operation)).status).toBe("conflict");
    expect(await readFile(join(root, "hello.ts"), "utf8")).toBe("agent update");
  });
  it("bounds reads, rejects binary data, and preserves UTF-8 BOM and CRLF", async () => {
    await writeFile(join(root, "hello.ts"), Buffer.alloc(MAX_FILE_BYTES + 1));
    expect(await read()).toMatchObject({ status: "error" });
    await writeFile(join(root, "hello.ts"), Buffer.from([0xff, 0xfe]));
    expect(await read()).toMatchObject({ status: "error" });
    const content = "\uFEFFconst café = 1;\r\n";
    await writeFile(join(root, "hello.ts"), content);
    expect(await read()).toMatchObject({ status: "read", file: { content } });
  });
  it("rejects traversal, absolute paths, stale epochs, missing projects, and symlink escapes", async () => {
    await writeFile(join(directory, "outside.txt"), "outside");
    for (const path of [
      "../outside.txt",
      "..\\outside.txt",
      join(directory, "outside.txt"),
      "C:\\outside.txt",
    ]) {
      expect((await request({ kind: "read", projectId, epoch, path })).status).toBe("error");
    }
    expect(
      (await request({ kind: "read", projectId, epoch: randomUUID(), path: "hello.ts" })).status,
    ).toBe("error");
    expect(
      (await request({ kind: "read", projectId: randomUUID(), epoch, path: "hello.ts" })).status,
    ).toBe("error");
    await symlink(directory, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(
      (await request({ kind: "read", projectId, epoch, path: "link/outside.txt" })).status,
    ).toBe("error");
    expect((await request({ kind: "list", projectId, epoch, path: "link" })).status).toBe("error");
    await rm(join(root, "hello.ts"));
    expect(await read()).toMatchObject({
      status: "error",
      message: expect.stringContaining("no longer exists"),
    });
  });
});
