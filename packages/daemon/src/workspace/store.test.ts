import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AgentInfoSchema, type WorkspaceCommand } from "@concors/protocol";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "./store.ts";

describe("workspace persistence", () => {
  it("persists machine identity, layout and command receipts across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "concors-workspace-"));
    const path = join(directory, "workspace.sqlite");
    let store = new WorkspaceStore(path);
    try {
      const original = store.snapshot();
      const command: WorkspaceCommand = {
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: original.epoch,
        operation: {
          kind: "project.add",
          projectId: randomUUID(),
          name: "Concors",
          directory: "/concors",
        },
      };
      const accepted = store.execute(command);
      store.close();
      store = new WorkspaceStore(path);
      expect(store.snapshot()).toEqual(accepted.snapshot);
      expect(store.snapshot().machineId).toBe(original.machineId);
      const retry = store.execute(command);
      expect(retry.result).toEqual(accepted.result);
      expect(retry.changed).toBe(false);
      expect(retry.snapshot.revision).toBe(1);
      const collision = store.execute({
        ...command,
        operation: {
          ...command.operation,
          kind: "project.add",
          projectId: randomUUID(),
          name: "Other",
          directory: "/other",
        },
      });
      expect(collision.result.outcome).toMatchObject({
        status: "rejected",
        code: "INVALID_OPERATION",
      });
      expect(store.snapshot().projects).toHaveLength(1);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an old epoch without mutating state and remembers the rejection", () => {
    const store = new WorkspaceStore();
    try {
      const command: WorkspaceCommand = {
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: randomUUID(),
        operation: {
          kind: "project.add",
          projectId: randomUUID(),
          name: "Wrong epoch",
          directory: "/wrong",
        },
      };
      const result = store.execute(command);
      expect(result.result.outcome).toMatchObject({ status: "rejected", code: "CONFLICT" });
      expect(store.snapshot().revision).toBe(0);
      expect(store.execute(command).result).toEqual(result.result);
    } finally {
      store.close();
    }
  });

  it("rolls back state when writing the command receipt fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "concors-workspace-"));
    const path = join(directory, "workspace.sqlite");
    const store = new WorkspaceStore(path);
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "CREATE TRIGGER fail_receipt BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'disk failure simulation'); END",
      );
      expect(() =>
        store.execute({
          type: "workspace.command",
          commandId: randomUUID(),
          epoch: store.snapshot().epoch,
          operation: {
            kind: "project.add",
            projectId: randomUUID(),
            name: "Atomic",
            directory: "/atomic",
          },
        }),
      ).toThrow("disk failure simulation");
      expect(store.snapshot().revision).toBe(0);
      expect(store.snapshot().projects).toHaveLength(0);
    } finally {
      db.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("moving chats between workspaces", () => {
  function setup() {
    const directory = mkdtempSync(join(tmpdir(), "concors-chat-move-"));
    const store = new WorkspaceStore(join(directory, "state.db"));
    const run = (operation: WorkspaceCommand["operation"]) =>
      store.execute({
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: store.snapshot().epoch,
        operation,
      });
    const from = randomUUID();
    const to = randomUUID();
    run({ kind: "project.add", projectId: from, name: "From", directory: "/projects/from" });
    run({ kind: "project.add", projectId: to, name: "To", directory: "/projects/to" });
    const now = new Date().toISOString();
    const chat = (id: string, providerGroupId?: string) =>
      store.createBackgroundAgent(
        AgentInfoSchema.parse({
          id,
          projectId: from,
          ...(providerGroupId ? { providerGroupId } : {}),
          provider: "codex",
          name: "Chat",
          directory: "/projects/from",
          model: null,
          threadId: "thread",
          turnId: "turn",
          status: "done",
          error: null,
          revision: 0,
          pending: [],
          startedAt: now,
          updatedAt: now,
          turnStartedAt: null,
        }),
      );
    const moved: string[] = [];
    store.onAgentsMoved = (agents) => moved.push(...agents.map((agent) => agent.id));
    const cleanup = () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    };
    return { store, run, from, to, chat, moved, cleanup };
  }

  it("moves a closed chat with the conversations a provider switch set aside, nothing else", () => {
    const { store, to, chat, moved, cleanup } = setup();
    try {
      const group = randomUUID();
      const [a, b, other] = [randomUUID(), randomUUID(), randomUUID()] as [string, string, string];
      chat(a, group);
      chat(b, group);
      chat(other);
      const before = store.agent(a);
      store.moveClosedChat(a, to);
      expect(store.agent(a).projectId).toBe(to);
      expect(store.agent(b).projectId).toBe(to);
      expect(store.agent(other).projectId).not.toBe(to);
      expect(moved.sort()).toEqual([a, b].sort());
      // It runs where it began, and moving it is not activity.
      expect(store.agent(a).directory).toBe("/projects/from");
      expect(store.agent(a).updatedAt).toBe(before.updatedAt);
      expect(store.agent(a).revision).toBe(before.revision + 1);
    } finally {
      cleanup();
    }
  });

  const open = (store: WorkspaceStore, sessionId: string) =>
    store.openAgent({
      type: "agent.request",
      requestId: randomUUID(),
      operation: { kind: "open-session", sessionId },
    });

  it("refuses a workspace that is gone, and a chat a pane still shows", () => {
    const { store, to, chat, cleanup } = setup();
    try {
      const id = randomUUID();
      chat(id);
      expect(() => store.moveClosedChat(id, randomUUID())).toThrow("no longer available");
      open(store, id);
      expect(() => store.moveClosedChat(id, to)).toThrow("This chat is open");
      expect(store.agent(id).projectId).not.toBe(to);
    } finally {
      cleanup();
    }
  });

  it("moves an open chat's tab, tells clients, and lets its folder be read from there", () => {
    const { store, run, from, to, chat, moved, cleanup } = setup();
    try {
      const group = randomUUID();
      const [id, aside] = [randomUUID(), randomUUID()] as [string, string];
      chat(id, group);
      chat(aside, group);
      open(store, id);
      const project = store.snapshot().projects.find((item) => item.id === from);
      const tab = project?.tabs[0];
      if (!project || !tab) throw new Error("Tab missing");
      const { result } = run({
        kind: "tab.transfer",
        projectId: from,
        expectedVersion: project.version,
        tabId: tab.id,
        targetProjectId: to,
      });
      expect(result.outcome.status).toBe("accepted");
      expect(store.agent(id).projectId).toBe(to);
      expect(store.agent(aside).projectId).toBe(to);
      // Files the chat links to stay readable from the workspace it is listed under now.
      expect(store.fileDirectory(to, "/projects/from")).toBe("/projects/from");
      return vi.waitFor(() => expect(moved.sort()).toEqual([id, aside].sort())).finally(cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  });

  it("leaves everything as it was when the move is refused", () => {
    const { store, run, from, to, chat, moved, cleanup } = setup();
    try {
      const id = randomUUID();
      chat(id);
      open(store, id);
      const project = store.snapshot().projects.find((item) => item.id === from);
      const tab = project?.tabs[0];
      if (!project || !tab) throw new Error("Tab missing");
      const { result } = run({
        kind: "tab.transfer",
        projectId: from,
        expectedVersion: project.version - 1,
        tabId: tab.id,
        targetProjectId: to,
      });
      expect(result.outcome.status).toBe("rejected");
      expect(store.agent(id).projectId).toBe(from);
      expect(moved).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
