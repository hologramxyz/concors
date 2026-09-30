import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentInfoSchema, type AgentEvent, type AgentInfo } from "@concors/protocol";
import { AgentManager } from "../agents/manager.ts";
import { AGENT_SESSION_LIMIT, WorkspaceStore } from "./store.ts";

let directory: string;
let store: WorkspaceStore;
let db: DatabaseSync;
let projectId: string;
const base = Date.parse("2026-09-01T00:00:00Z");
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "concors-retirement-"));
  store = new WorkspaceStore(join(directory, "state.db"));
  db = new DatabaseSync(join(directory, "state.db"));
  projectId = randomUUID();
  command({ kind: "project.add", projectId, name: "Retirement", directory });
});

afterEach(() => {
  db.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function command(operation: object) {
  const result = store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: store.snapshot().epoch,
    operation,
  } as Parameters<WorkspaceStore["execute"]>[0]);
  expect(result.result.outcome.status).toBe("accepted");
}

/** An empty chat pane in a tab of its own, ready for a new chat. */
function chatPane() {
  const tabId = randomUUID(),
    paneId = randomUUID();
  const version = store.snapshot().projects[0]!.version;
  command({
    kind: "tab.create",
    projectId,
    expectedVersion: version,
    tabId,
    paneId,
    name: "Chat",
    profile: "chat",
  });
  return { tabId, paneId };
}

function agent(minutes: number, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return AgentInfoSchema.parse({
    id: randomUUID(),
    projectId,
    provider: "codex",
    name: "Codex",
    directory,
    model: null,
    threadId: null,
    turnId: null,
    status: "done",
    pending: [],
    attention: null,
    error: null,
    startedAt: at(minutes),
    updatedAt: at(minutes),
    turnStartedAt: null,
    revision: 0,
    ...overrides,
  });
}

/** A closed chat, written directly as the store keeps it. */
function closed(info: AgentInfo) {
  db.prepare("INSERT INTO agents (id, info) VALUES (?, ?)").run(info.id, JSON.stringify(info));
  return info;
}

function start(info: AgentInfo) {
  const { tabId, paneId } = chatPane();
  return store.reserveAgent(
    {
      type: "agent.request",
      requestId: randomUUID(),
      operation: {
        kind: "start",
        epoch: store.snapshot().epoch,
        projectId,
        tabId,
        paneId,
        expectedVersion: store.snapshot().projects[0]!.version,
      },
    },
    info,
  );
}

const ids = () => store.agents().map((agent) => agent.id);
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

it("makes room by removing the oldest closed chat, with its history and files", async () => {
  // The chat open in a pane is the oldest of all, and still stays.
  const open = start(agent(-60));
  const working = closed(agent(0, { status: "working" }));
  const queued = closed(
    agent(1, { queue: [{ id: randomUUID(), text: "next", attachments: [], queuedAt: at(1) }] }),
  );
  const waiting = closed(agent(2));
  db.prepare("INSERT INTO agent_queue (id, session_id, request) VALUES (?, ?, ?)").run(
    randomUUID(),
    waiting.id,
    "{}",
  );
  const scheduled = closed(agent(3));
  store.keepAgents(() => [scheduled.id]);
  const oldest = closed(agent(4));
  store.saveAgentItem({
    id: "prompt",
    sessionId: oldest.id,
    turnId: "turn",
    position: 0,
    revision: 0,
    kind: "user",
    title: "",
    text: "An old question",
    detail: "",
    status: "completed",
    createdAt: at(4),
  });
  mkdirSync(join(store.attachmentsDirectory, oldest.id), { recursive: true });
  writeFileSync(join(store.attachmentsDirectory, oldest.id, "screenshot.png"), "png");
  for (let i = 5; store.agents().length < AGENT_SESSION_LIMIT; i++) closed(agent(i));
  const retired = vi.fn();
  store.onAgentsRetired = retired;

  const next = start(agent(1000));

  expect(store.agents()).toHaveLength(AGENT_SESSION_LIMIT);
  expect(ids()).toContain(next.id);
  expect(ids()).not.toContain(oldest.id);
  for (const kept of [open, working, queued, waiting, scheduled]) expect(ids()).toContain(kept.id);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM agent_items WHERE session_id = ?").get(oldest.id),
  ).toEqual({ n: 0 });
  await settle();
  expect(existsSync(join(store.attachmentsDirectory, oldest.id))).toBe(false);
  expect(retired).toHaveBeenCalledExactlyOnceWith([oldest.id]);
});

it("refuses a new chat only when every chat is open or active, and says so", () => {
  for (let i = 0; store.agents().length < AGENT_SESSION_LIMIT; i++) closed(agent(i));
  store.keepAgents(ids);
  expect(() => start(agent(1000))).toThrow(
    `All ${AGENT_SESSION_LIMIT} chats on this machine are open or active. Close one to start another.`,
  );
  expect(store.agents()).toHaveLength(AGENT_SESSION_LIMIT);
});

it("keeps the old chat and its files when starting the new one fails", async () => {
  const oldest = closed(agent(0));
  mkdirSync(join(store.attachmentsDirectory, oldest.id), { recursive: true });
  for (let i = 1; store.agents().length < AGENT_SESSION_LIMIT; i++) closed(agent(i));
  const retired = vi.fn();
  store.onAgentsRetired = retired;
  // Written with the id of a chat that exists, so the insert fails after room was made and the
  // whole start rolls back.
  const duplicate = agent(1000, { id: ids().at(-1)! });
  expect(() => start(duplicate)).toThrow();
  await settle();
  expect(ids()).toContain(oldest.id);
  expect(existsSync(join(store.attachmentsDirectory, oldest.id))).toBe(true);
  expect(retired).not.toHaveBeenCalled();
});

it("tells clients the chats that remain, since a full list replaces theirs", async () => {
  const events: AgentEvent[] = [];
  const manager = new AgentManager(
    store,
    (event) => events.push(event),
    () => undefined,
  );
  try {
    const oldest = closed(agent(0));
    for (let i = 1; store.agents().length < AGENT_SESSION_LIMIT; i++) closed(agent(i));
    const next = start(agent(1000));
    await settle();
    const list = events.find((event) => event.type === "agent.list");
    expect(list?.type === "agent.list" && list.agents.map((agent) => agent.id)).toEqual(ids());
    expect(ids()).toContain(next.id);
    expect(ids()).not.toContain(oldest.id);
  } finally {
    await manager.close();
  }
});
