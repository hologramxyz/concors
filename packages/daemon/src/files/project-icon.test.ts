import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileResultSchema, MAX_PROJECT_ICON_BYTES } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { ProjectFiles } from "./service.ts";

let directory: string, root: string, projectId: string, epoch: string;
let store: WorkspaceStore, files: ProjectFiles;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="blue" d="M0 0h16v16H0z"/></svg>';
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
const write = async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
const request = async (overrides = {}) => {
  const result = await files.request({
    type: "file.request",
    requestId: randomUUID(),
    operation: { kind: "project-icon", epoch, projectId, path: "", ...overrides },
  });
  expect(FileResultSchema.safeParse(result).success).toBe(true);
  return result.outcome;
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "concors-project-icons-"));
  root = join(directory, "repo");
  await mkdir(root);
  store = new WorkspaceStore();
  files = new ProjectFiles(store);
  projectId = randomUUID();
  epoch = store.snapshot().epoch;
  store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch,
    operation: { kind: "project.add", projectId, name: "Project", directory: root },
  });
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

it("keeps ordinary folders as folders, even with a favicon, and recognizes newly initialized repos", async () => {
  await write("favicon.svg", svg);
  expect(await request()).toEqual({ status: "project-icon", icon: { isGit: false, source: null } });
  git("init", "--quiet");
  expect(await request()).toEqual({
    status: "project-icon",
    icon: {
      isGit: true,
      source: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    },
  });
  await rm(join(root, "favicon.svg"));
  expect(await request()).toEqual({ status: "project-icon", icon: { isGit: true, source: null } });
});
it("finds local public and monorepo app favicons in deterministic priority order", async () => {
  git("init", "--quiet");
  await write("apps/web/src/app/icon.svg", svg);
  const nested = await request();
  expect(nested).toMatchObject({
    status: "project-icon",
    icon: { isGit: true, source: expect.stringContaining("data:image/svg+xml;base64,") },
  });
  await write("public/favicon.svg", svg.replace("blue", "red"));
  expect(await request()).not.toEqual(nested);
  await write("favicon.svg", svg);
  expect(await request()).toEqual(nested);
});
it.each([
  ["png", "png", [137, 80, 78, 71, 13, 10, 26, 10]],
  ["ico", "x-icon", [0, 0, 1, 0, 1, 0]],
  ["webp", "webp", [...Buffer.from("RIFF0000WEBP")]],
] as const)("transports %s favicons as bounded image data", async (extension, mime, bytes) => {
  git("init", "--quiet");
  await write(`public/favicon.${extension}`, Buffer.from(bytes));
  expect(await request()).toEqual({
    status: "project-icon",
    icon: {
      isGit: true,
      source: `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    },
  });
});
it("recognizes Git worktrees without treating the .git file as a favicon", async () => {
  git("init", "--quiet");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const worktree = join(directory, "worktree");
  git("worktree", "add", "--detach", worktree);
  const id = randomUUID();
  store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch,
    operation: { kind: "project.add", projectId: id, name: "Worktree", directory: worktree },
  });
  expect(await request({ projectId: id })).toEqual({
    status: "project-icon",
    icon: { isGit: true, source: null },
  });
});
it("ignores oversized, mismatched and generated/dependency assets", async () => {
  git("init", "--quiet");
  await write("favicon.svg", svg + " ".repeat(MAX_PROJECT_ICON_BYTES));
  await write("favicon.png", "not a png");
  await write("node_modules/library/public/favicon.svg", svg);
  await write("dist/favicon.svg", svg);
  expect(await request()).toEqual({ status: "project-icon", icon: { isGit: true, source: null } });
});
it("does not read icons through directory links or outside the selected project", async () => {
  git("init", "--quiet");
  const outside = join(directory, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "favicon.svg"), svg);
  await symlink(outside, join(root, "public"), process.platform === "win32" ? "junction" : "dir");
  expect(await request()).toEqual({ status: "project-icon", icon: { isGit: true, source: null } });
  expect(await request({ directory: outside })).toMatchObject({ status: "error" });
  expect(await request({ epoch: randomUUID() })).toMatchObject({ status: "error" });
  expect(await request({ projectId: randomUUID() })).toMatchObject({ status: "error" });
});
it("rejects remote URLs in project icon responses", () => {
  expect(
    FileResultSchema.safeParse({
      type: "file.result",
      requestId: randomUUID(),
      outcome: {
        status: "project-icon",
        icon: { isGit: true, source: "https://example.com/favicon.png" },
      },
    }).success,
  ).toBe(false);
});
