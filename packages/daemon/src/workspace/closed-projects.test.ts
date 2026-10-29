import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AgentInfoSchema, type AgentInfo, type WorkspaceOperation } from "@concors/protocol";
import { ProjectManager } from "../projects/manager.ts";
import { WorkspaceStore } from "./store.ts";

let directory: string;
let store: WorkspaceStore;
let db: DatabaseSync;

beforeEach(async () => {
  directory = await realpath(mkdtempSync(join(tmpdir(), "concors-closed-")));
  store = new WorkspaceStore(join(directory, "state.db"));
  db = new DatabaseSync(join(directory, "state.db"));
});

afterEach(() => {
  db.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function execute(operation: WorkspaceOperation) {
  return store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: store.snapshot().epoch,
    operation,
  }).result.outcome;
}

/** A workspace on its own folder, with one chat tab whose pane shows `chat` when given. */
function workspace(name: string, chat?: AgentInfo) {
  const projectId = randomUUID();
  const folder = join(directory, name);
  mkdirSync(folder, { recursive: true });
  execute({ kind: "project.add", projectId, name, directory: folder });
  const tabId = randomUUID(),
    paneId = randomUUID();
  execute({
    kind: "tab.create",
    projectId,
    expectedVersion: 0,
    tabId,
    paneId,
    name: "Chat",
    profile: "chat",
  });
  if (chat) {
    saved({ ...chat, projectId, directory: folder });
    const state = store.snapshot();
    const pane = state.projects.find((p) => p.id === projectId)!.tabs[0]!.nodes[0]!;
    if (pane.kind === "pane") pane.sessionId = chat.id;
    db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
  }
  return { projectId, folder, tabId };
}

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return AgentInfoSchema.parse({
    id: randomUUID(),
    projectId: randomUUID(),
    provider: "codex",
    name: "Codex",
    directory,
    model: null,
    threadId: null,
    turnId: "turn",
    status: "done",
    pending: [],
    attention: null,
    error: null,
    startedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    turnStartedAt: null,
    revision: 0,
    ...overrides,
  });
}

function saved(info: AgentInfo) {
  db.prepare("INSERT INTO agents (id, info) VALUES (?, ?)").run(info.id, JSON.stringify(info));
  return info;
}

/** Open folder… on `folder`, with `home` as the machine's home folder; settles once it is done. */
async function openFolder(folder: string, home = directory) {
  const manager = new ProjectManager(store, () => undefined, home);
  try {
    const id = randomUUID();
    manager.request({
      type: "project.request",
      requestId: randomUUID(),
      operation: {
        kind: "start",
        epoch: store.snapshot().epoch,
        id,
        mode: "open",
        name: "app",
        directory: folder,
        repository: "",
      },
    });
    await expect.poll(() => store.projectSetups().find((s) => s.id === id)?.status).toBe("done");
  } finally {
    manager.close();
  }
}

const project = (id: string) => store.snapshot().projects.find((p) => p.id === id);
const version = (id: string) => project(id)!.version;

it("closes a workspace and reopens it with its tabs and chats", () => {
  const chat = agent();
  const { projectId, folder, tabId } = workspace("app", chat);
  expect(
    execute({ kind: "project.close", projectId, expectedVersion: version(projectId) }),
  ).toEqual(expect.objectContaining({ status: "accepted" }));
  expect(project(projectId)).toBeUndefined();
  expect(store.snapshot().closedProjects).toEqual([
    expect.objectContaining({ id: projectId, name: "app", directory: folder }),
  ]);
  // The chat is kept, still in its workspace, and no pane shows it any more.
  expect(store.agent(chat.id).projectId).toBe(projectId);
  expect(store.closedProjectAt(folder)).toBe(projectId);

  expect(execute({ kind: "project.reopen", projectId }).status).toBe("accepted");
  const reopened = project(projectId)!;
  expect(reopened.tabs.map((tab) => tab.id)).toEqual([tabId]);
  expect(reopened.tabs[0]!.nodes[0]).toMatchObject({ sessionId: chat.id });
  expect(store.snapshot().selection).toEqual({ projectId, tabId });
  expect(store.snapshot().closedProjects).toEqual([]);
  expect(store.closedProjectAt(folder)).toBeNull();
});

it("opens a pane whose chat was deleted while closed to the start screen", () => {
  const chat = agent();
  const { projectId } = workspace("app", chat);
  execute({ kind: "project.close", projectId, expectedVersion: version(projectId) });
  store.deleteAgent(chat.id);
  execute({ kind: "project.reopen", projectId });
  expect(project(projectId)!.tabs[0]!.nodes[0]).toMatchObject({ sessionId: null });
});

it("keeps every closed workspace on a folder, and reopens each by its ID", () => {
  // One-click workspaces all start in the home folder, so several closed ones share it.
  const first = workspace("home");
  execute({ kind: "project.close", projectId: first.projectId, expectedVersion: 1 });
  const second = workspace("home");
  execute({ kind: "project.close", projectId: second.projectId, expectedVersion: 1 });
  expect(store.snapshot().closedProjects?.map((p) => p.id)).toEqual([
    second.projectId,
    first.projectId,
  ]);
  // Even with another workspace open on that folder.
  const open = randomUUID();
  execute({ kind: "project.add", projectId: open, name: "home", directory: first.folder });
  expect(execute({ kind: "project.reopen", projectId: first.projectId }).status).toBe("accepted");
  expect(store.snapshot().projects.map((p) => p.id)).toEqual([open, first.projectId]);
});

it("moves chats of a removed workspace into one opened on their folder", async () => {
  const folder = join(directory, "app");
  const stray = saved(agent({ directory: join(folder, "src") }));
  const elsewhere = saved(agent({ directory: join(directory, "apple") }));
  const moved: AgentInfo[] = [];
  store.onAgentsMoved = (agents) => moved.push(...agents);
  const { projectId } = workspace("app");
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(store.agent(stray.id).projectId).toBe(projectId);
  expect(store.agent(elsewhere.id).projectId).toBe(elsewhere.projectId);
  expect(moved.map((agent) => agent.id)).toEqual([stray.id]);
});

it("leaves chats of a closed workspace where they are when another folder opens", () => {
  const chat = agent();
  const { projectId } = workspace("app", chat);
  execute({ kind: "project.close", projectId, expectedVersion: version(projectId) });
  workspace("app/nested");
  expect(store.agent(chat.id).projectId).toBe(projectId);
});

it("brings the most recently closed workspace on a folder back when it is opened", async () => {
  const first = workspace("app");
  execute({ kind: "project.close", projectId: first.projectId, expectedVersion: 1 });
  const second = workspace("app");
  execute({ kind: "project.close", projectId: second.projectId, expectedVersion: 1 });
  await openFolder(first.folder);
  expect(store.snapshot().projects.map((p) => p.id)).toEqual([second.projectId]);
});

it("never brings a closed workspace back for the home folder", async () => {
  const { projectId, folder } = workspace("home");
  execute({ kind: "project.close", projectId, expectedVersion: 1 });
  await openFolder(folder, folder);
  expect(store.snapshot().projects.map((p) => p.id)).not.toContain(projectId);
  expect(store.snapshot().closedProjects?.map((p) => p.id)).toEqual([projectId]);
});

it("moves chats of a removed workspace into the open one when its folder is opened again", async () => {
  const { projectId, folder } = workspace("app");
  const stray = saved(agent({ directory: folder }));
  await openFolder(folder);
  expect(store.agent(stray.id).projectId).toBe(projectId);
});
