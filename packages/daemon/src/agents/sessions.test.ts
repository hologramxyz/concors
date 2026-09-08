import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { AgentOperation, WorkspaceOperation } from "@concors/protocol";
import { afterEach, expect, it } from "vitest";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "./testing/provider.ts";

let server: DaemonServer | undefined;
let directory = "";
const clients: DaemonConnection[] = [];
const providers: TestAgentProvider[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  providers.length = 0;
});
async function boot() {
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
    workspacePath: join(directory, "state.db"),
    agentProviderFactory: (_cwd, handler) => {
      const provider = new TestAgentProvider(handler);
      providers.push(provider);
      return provider;
    },
  });
  return server.listen();
}
async function open(url: string) {
  const c = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "chat", version: "0.0.0" },
  });
  clients.push(c);
  c.subscribeWorkspace(() => undefined);
  await c.connect();
  await expect.poll(() => c.workspace).not.toBeNull();
  return c;
}
async function action(c: DaemonConnection, op: AgentOperation, id = randomUUID()) {
  return c.requestAgent(op, id);
}
async function setup() {
  directory = await mkdtemp(join(tmpdir(), "concors-chat-"));
  const url = await boot();
  const a = await open(url),
    b = await open(url);
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  const command = (operation: WorkspaceOperation) =>
    a.executeWorkspace({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: a.workspace!.epoch,
      operation,
    });
  await command({ kind: "project.add", projectId, name: "Chat", directory });
  await command({
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Chat",
    profile: "chat",
  });
  const requestId = randomUUID();
  const start: AgentOperation = {
    kind: "start",
    epoch: a.workspace!.epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
  };
  const result = await action(a, start, requestId);
  expect(result.outcome.status).toBe("ok");
  await expect.poll(() => a.agents[0]?.status).toBe("idle");
  const id = a.agents[0]!.id;
  expect((await action(b, start, requestId)).outcome.status).toBe("ok");
  expect(providers).toHaveLength(1);
  return { a, b, id, url };
}
it("streams one shared turn, reconnects without replay, persists history and resumes after restart", async () => {
  const { a, b, id, url } = await setup();
  const requestId = randomUUID();
  const op: AgentOperation = { kind: "send", sessionId: id, text: "hold the stream" };
  expect((await action(a, op, requestId)).outcome.status).toBe("ok");
  await expect.poll(() => b.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const turn = b.agents[0]!.turnId!;
  const count = TestAgentProvider.turns;
  await action(b, op, requestId);
  expect(TestAgentProvider.turns).toBe(count);
  expect((await action(b, { ...op, text: "different" }, requestId)).outcome.status).toBe("error");
  expect(
    (await action(b, { kind: "send", sessionId: id, text: "concurrent" })).outcome.status,
  ).toBe("error");
  b.disconnect();
  const c = await open(url);
  const result = await action(c, { kind: "read", sessionId: id });
  expect(result.outcome.status).toBe("ok");
  if (result.outcome.status === "ok")
    expect(result.outcome.conversation.items.map((i) => i.text)).toEqual([
      "hold the stream",
      "Hello from ",
    ]);
  await action(c, { kind: "interrupt", sessionId: id, turnId: turn });
  await expect.poll(() => a.agents[0]?.status).toBe("interrupted");
  a.disconnect();
  c.disconnect();
  await server!.close();
  const next = await open(await boot());
  expect(next.agents[0]?.id).toBe(id);
  expect((await action(next, { kind: "read", sessionId: id })).outcome.status).toBe("ok");
  await action(next, { kind: "send", sessionId: id, text: "hello" });
  await expect.poll(() => next.agents[0]?.status).toBe("done");
  expect(providers).toHaveLength(2);
  expect(TestAgentProvider.turns).toBe(count + 1);
});
it("answers approvals once across clients, tracks input/failure and ignores late completion", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "approve command" });
  await expect.poll(() => b.agents[0]?.status).toBe("needs_input");
  const approval = b.agents[0]!.pending[0]!;
  expect(
    (
      await action(b, {
        kind: "respond",
        sessionId: id,
        pendingId: approval.id,
        decision: "decline",
      })
    ).outcome.status,
  ).toBe("ok");
  expect(
    (
      await action(a, {
        kind: "respond",
        sessionId: id,
        pendingId: approval.id,
        decision: "accept",
      })
    ).outcome.status,
  ).toBe("error");
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const old = a.agents[0]!.turnId!;
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  await expect.poll(() => a.agents[0]?.turnId).not.toBe(old);
  providers[0]!.finish("completed", old);
  expect((await action(b, { kind: "read", sessionId: id })).outcome).toMatchObject({
    status: "ok",
    conversation: { agent: { status: "working" } },
  });
  await action(a, { kind: "interrupt", sessionId: id, turnId: a.agents[0]!.turnId! });
  await action(a, { kind: "send", sessionId: id, text: "question" });
  await expect.poll(() => b.agents[0]?.status).toBe("needs_input");
  await action(b, {
    kind: "respond",
    sessionId: id,
    pendingId: b.agents[0]!.pending[0]!.id,
    answers: { color: ["Blue"] },
  });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  await action(a, { kind: "send", sessionId: id, text: "fail" });
  await expect.poll(() => b.agents[0]?.status).toBe("failed");
  expect(b.agents[0]?.error).toBe("Fixture failure");
});
it("marks a crashed active turn interrupted and never replays a durable prompt receipt", async () => {
  const { a, id } = await setup();
  const requestId = randomUUID();
  const op: AgentOperation = { kind: "send", sessionId: id, text: "hold" };
  await action(a, op, requestId);
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const count = TestAgentProvider.turns;
  a.disconnect();
  await server!.close();
  const b = await open(await boot());
  expect(b.agents[0]?.status).toBe("interrupted");
  expect((await action(b, op, requestId)).outcome.status).toBe("ok");
  expect(TestAgentProvider.turns).toBe(count);
  expect(b.agents[0]?.pending).toEqual([]);
});

it("syncs attention acknowledgements, rejects stale reads, and preserves unread state across restart", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  providers[0]!.finish();
  await expect.poll(() => b.agents[0]?.attention?.kind).toBe("done");
  const first = b.agents[0]!.attention!;
  expect(first.seen).toBe(false);
  providers[0]!.finish();
  await action(b, { kind: "read", sessionId: id });
  expect(b.agents[0]!.attention!.id).toBe(first.id);
  const finishedAt = a.agents[0]!.updatedAt;
  await action(b, { kind: "seen", sessionId: id, attentionId: first.id });
  await expect.poll(() => a.agents[0]?.attention?.seen).toBe(true);
  expect(a.agents[0]!.updatedAt).toBe(finishedAt);

  await action(a, { kind: "send", sessionId: id, text: "hold again" });
  await expect.poll(() => b.agents[0]?.attention).toBeNull();
  providers[0]!.finish();
  await expect.poll(() => b.agents[0]?.attention?.kind).toBe("done");
  const second = b.agents[0]!.attention!;
  expect(second.id).not.toBe(first.id);
  await action(b, { kind: "seen", sessionId: id, attentionId: first.id });
  expect(b.agents[0]!.attention!.seen).toBe(false);
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot());
  expect(c.agents[0]!.attention).toEqual(second);
});

it("creates separate attention for input and completion and clears it when answering", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "question" });
  await expect.poll(() => b.agents[0]?.attention?.kind).toBe("needs_input");
  const input = b.agents[0]!.attention!;
  await action(b, { kind: "seen", sessionId: id, attentionId: input.id });
  await expect.poll(() => a.agents[0]?.attention?.seen).toBe(true);
  await action(a, {
    kind: "respond",
    sessionId: id,
    pendingId: a.agents[0]!.pending[0]!.id,
    answers: { color: ["Blue"] },
  });
  await expect.poll(() => b.agents[0]?.attention?.kind).toBe("done");
  expect(b.agents[0]!.attention!.id).not.toBe(input.id);
  expect(b.agents[0]!.attention!.seen).toBe(false);
});
