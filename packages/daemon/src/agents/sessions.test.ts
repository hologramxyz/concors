import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { AgentOperation, WorkspaceOperation } from "@concors/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "./testing/provider.ts";
import { TestAccountBackend } from "./testing/account.ts";
import { ProviderRegistry } from "./providers/registry.ts";

// Every test here spawns a daemon plus a fake provider; Windows CI runners need well over the
// 5 s default before the first turn streams.
vi.setConfig({ testTimeout: 15_000 });

let server: DaemonServer | undefined;
let directory = "";
const clients: DaemonConnection[] = [];
const providers: TestAgentProvider[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  providers.length = 0;
  vi.restoreAllMocks();
});
async function boot(resumeError?: string) {
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
    workspacePath: join(directory, "state.db"),
    accountBackendFactory: (info) => new TestAccountBackend(info),
    agentProviderFactory: (_cwd, handler) => {
      const provider = new TestAgentProvider(handler);
      provider.cwd = _cwd;
      if (resumeError) {
        provider.threadId = `fixture-thread-${providers.length}`;
        const request = provider.request.bind(provider);
        vi.spyOn(provider, "request").mockImplementation(async (method, params) => {
          if (method === "thread/resume") {
            provider.requests.push({ method, params });
            throw new Error(
              resumeError === "missing"
                ? `no rollout found for thread id ${(params as { threadId: string }).threadId}`
                : resumeError,
            );
          }
          return request(method, params);
        });
      }
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
async function setup(resumeError?: string) {
  directory = await mkdtemp(join(tmpdir(), "concors-chat-"));
  const url = await boot(resumeError);
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
it("pages saved chat history in both directions without skipping byte-limited messages", async () => {
  const { a, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold history" });
  const provider = providers[0]!;
  for (let index = 0; index < 120; index++)
    provider.emit("item/completed", {
      item: { id: `history-${index}`, type: "agentMessage", text: `${index}: ${"x".repeat(8000)}` },
    });
  const read = async (cursor: { before?: number; after?: number } = {}) => {
    const result = await action(a, { kind: "read", sessionId: id, ...cursor });
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    return result.outcome.conversation;
  };
  let page = await read();
  expect(page.hasNewer).toBe(false);
  expect(page.items.length).toBeLessThan(80);
  let all = page.items;
  while (page.hasMore) {
    page = await read({ before: page.items[0]!.position });
    expect(page.items.length).toBeGreaterThan(0);
    all = [...page.items, ...all];
  }
  expect(all).toHaveLength(122);
  expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
  const forward = [...page.items];
  while (page.hasNewer) {
    page = await read({ after: page.items.at(-1)!.position });
    expect(page.items.length).toBeGreaterThan(0);
    forward.push(...page.items);
  }
  expect(forward).toEqual(all);
  expect((await read({ before: 0 })).items).toEqual([]);
  expect((await read({ after: all.at(-1)!.position })).items).toEqual([]);
});
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

it("cancels the turn from an approval, settles other requests, and ignores late output", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "approve command" });
  await expect.poll(() => a.agents[0]?.pending.length).toBe(1);
  const pending = a.agents[0]!.pending[0]!;
  const provider = providers[0]!;
  const other = provider
    .onRequest(
      "item/commandExecution/requestApproval",
      {
        threadId: provider.threadId,
        turnId: pending.turnId,
        command: "second command",
      },
      "second-approval",
    )
    .catch((error: Error) => error.message);
  await expect.poll(() => b.agents[0]?.pending.length).toBe(2);
  expect(
    (await action(a, { kind: "respond", sessionId: id, pendingId: pending.id, decision: "cancel" }))
      .outcome.status,
  ).toBe("ok");
  await expect.poll(() => b.agents[0]?.status).toBe("interrupted");
  expect(await other).toBe("Turn ended");
  expect(provider.requests.some((r) => r.method === "turn/interrupt")).toBe(true);
  provider.emit("item/completed", {
    item: { id: "late-output", type: "agentMessage", text: "Should not appear" },
  });
  provider.finish();
  const result = await action(b, { kind: "read", sessionId: id });
  expect(result.outcome).toMatchObject({
    status: "ok",
    conversation: { agent: { status: "interrupted", pending: [] } },
  });
  if (result.outcome.status === "ok")
    expect(result.outcome.conversation.items.some((i) => i.id === "late-output")).toBe(false);
  await action(a, { kind: "send", sessionId: id, text: "next message" });
  await expect.poll(() => b.agents[0]?.status).toBe("done");
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

it("syncs model and permission choices, rejects stale edits, and forwards uploads to the provider", async () => {
  const { a, b, id } = await setup();
  expect(a.agents[0]!.models?.[0]?.id).toBe("fixture");
  const settings = { model: "fixture", effort: "high" as const, mode: "auto-review" as const };
  const revision = a.agents[0]!.revision;
  expect(
    (await action(a, { kind: "configure", sessionId: id, settings, expectedRevision: revision }))
      .outcome.status,
  ).toBe("ok");
  await expect.poll(() => b.agents[0]?.settings).toEqual(settings);
  expect(
    (
      await action(b, {
        kind: "configure",
        sessionId: id,
        settings: { ...settings, mode: "full-access" },
        expectedRevision: revision,
      })
    ).outcome.status,
  ).toBe("error");
  const attachment = {
    name: "../../note.txt",
    mime: "text/plain",
    data: Buffer.from("attached content").toString("base64"),
  };
  const requestId = randomUUID();
  await action(
    a,
    { kind: "send", sessionId: id, text: "hold", attachments: [attachment] },
    requestId,
  );
  await expect
    .poll(() => providers[0]!.requests.filter((r) => r.method === "turn/start").length)
    .toBe(1);
  const params = providers[0]!.requests.find((r) => r.method === "turn/start")!.params as {
    input: { type: string; text: string }[];
  };
  expect(params).toMatchObject({
    model: "fixture",
    effort: "high",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
  });
  const path = params.input[1]!.text.split("Its file on this machine is: ")[1]!;
  expect(path.startsWith(join(directory, "attachments", id))).toBe(true);
  expect(await readFile(path, "utf8")).toBe("attached content");
  await action(
    b,
    { kind: "send", sessionId: id, text: "hold", attachments: [attachment] },
    requestId,
  );
  expect(providers[0]!.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
  expect(
    (
      await action(a, {
        kind: "configure",
        sessionId: id,
        settings: { ...settings, mode: "full-access" },
        expectedRevision: a.agents[0]!.revision,
      })
    ).outcome.status,
  ).toBe("ok");
  expect(params).toMatchObject({
    approvalsReviewer: "auto_review",
    sandboxPolicy: { type: "workspaceWrite" },
  });
  providers[0]!.finish();
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  await action(a, {
    kind: "configure",
    sessionId: id,
    settings: { ...settings, mode: "full-access" },
    expectedRevision: a.agents[0]!.revision,
  });
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  await expect
    .poll(() => providers[0]!.requests.filter((r) => r.method === "turn/start").length)
    .toBe(2);
  expect(providers[0]!.requests.filter((r) => r.method === "turn/start")[1]!.params).toMatchObject({
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
});

it("streams structured plans, thinking summaries, child activity and context usage", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const provider = providers[0]!;
  provider.emit("turn/plan/updated", {
    plan: [
      { step: "Inspect", status: "completed" },
      { step: "Implement", status: "inProgress" },
    ],
  });
  provider.emit("item/started", {
    item: {
      id: "reasoning",
      type: "reasoning",
      summary: ["Reviewing the files"],
      content: ["not for display"],
    },
  });
  provider.emit("item/started", {
    item: {
      id: "children",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      receiverThreadIds: ["child"],
      agentsStates: { child: { status: "running", message: null } },
      prompt: "Inspect tests",
    },
  });
  provider.emit("turn/completed", {
    threadId: "child",
    turn: { id: "child-turn", status: "completed", items: [], error: null },
  });
  provider.emit("thread/tokenUsage/updated", {
    tokenUsage: {
      last: { totalTokens: 1234 },
      total: { totalTokens: 4567 },
      modelContextWindow: 128000,
    },
  });
  await expect.poll(() => b.agents[0]?.context?.used).toBe(1234);
  const result = await action(b, { kind: "read", sessionId: id });
  expect(result.outcome.status).toBe("ok");
  if (result.outcome.status !== "ok") return;
  expect(
    result.outcome.conversation.items.find((i) => i.id === "children")?.presentation?.children?.[0]
      ?.status,
  ).toBe("completed");
  expect(result.outcome.conversation.items.find((i) => i.id === "reasoning")?.text).toBe(
    "Reviewing the files",
  );
  expect(JSON.stringify(result.outcome.conversation.items)).not.toContain("not for display");
  expect(
    result.outcome.conversation.items.find((i) => i.kind === "plan")?.presentation?.steps?.[1]
      ?.status,
  ).toBe("inProgress");
  expect(a.agents[0]?.status).toBe("working");
});

it("shares native plan and speed controls, resets plan mode, and rejects unavailable tiers", async () => {
  const { a, b, id } = await setup();
  expect(a.agents[0]?.supportsPlan).toBe(true);
  const settings = {
    model: "fixture",
    effort: "high",
    mode: "auto-review" as const,
    planMode: true,
    serviceTier: "fast",
  };
  expect(
    (
      await action(a, {
        kind: "configure",
        sessionId: id,
        settings,
        expectedRevision: a.agents[0]!.revision,
      })
    ).outcome.status,
  ).toBe("ok");
  await expect.poll(() => b.agents[0]?.settings?.planMode).toBe(true);
  await action(b, { kind: "send", sessionId: id, text: "hold planning" });
  await expect
    .poll(() => providers[0]!.requests.filter((r) => r.method === "turn/start").length)
    .toBe(1);
  expect(providers[0]!.requests.find((r) => r.method === "turn/start")?.params).toMatchObject({
    serviceTier: "fast",
    sandboxPolicy: { type: "readOnly" },
    collaborationMode: { mode: "plan", settings: { model: "fixture", reasoning_effort: "high" } },
  });
  providers[0]!.finish();
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  expect(
    (
      await action(a, {
        kind: "configure",
        sessionId: id,
        settings: { ...settings, serviceTier: "not-available" },
        expectedRevision: a.agents[0]!.revision,
      })
    ).outcome.status,
  ).toBe("error");
  expect(
    (
      await action(a, {
        kind: "configure",
        sessionId: id,
        settings: { ...settings, planMode: false, serviceTier: null },
        expectedRevision: a.agents[0]!.revision,
      })
    ).outcome.status,
  ).toBe("ok");
  await action(a, { kind: "send", sessionId: id, text: "hold implementation" });
  await expect
    .poll(() => providers[0]!.requests.filter((r) => r.method === "turn/start").length)
    .toBe(2);
  expect(providers[0]!.requests.filter((r) => r.method === "turn/start")[1]?.params).toMatchObject({
    serviceTier: null,
    sandboxPolicy: { type: "workspaceWrite" },
    collaborationMode: { mode: "default" },
  });
});

it("switches a bound Agent pane to a terminal without stopping the shared agent", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  await expect.poll(() => a.agents[0]?.status).toBe("working");
  const project = a.workspace!.projects[0]!,
    tab = project.tabs[0]!,
    pane = tab.nodes.find((n) => n.kind === "pane")!;
  await a.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: a.workspace!.epoch,
    operation: {
      kind: "pane.configure",
      projectId: project.id,
      tabId: tab.id,
      paneId: pane.id,
      expectedVersion: project.version,
      profile: "shell",
    },
  });
  await expect
    .poll(() => b.workspace!.projects[0]!.tabs[0]!.nodes[0])
    .toMatchObject({ profile: "shell", sessionId: null });
  expect(b.agents[0]?.status).toBe("working");
  expect(providers[0]?.closed).toBe(false);
  expect((await action(b, { kind: "read", sessionId: id })).outcome.status).toBe("ok");
});

it("delivers durable follow-ups after every client disconnects and deduplicates enqueue retries", async () => {
  const { a, b, id, url } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold this turn" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const requestId = randomUUID();
  const queued: AgentOperation = {
    kind: "queue-add",
    sessionId: id,
    text: "continue after disconnect",
  };
  expect((await action(a, queued, requestId)).outcome.status).toBe("ok");
  expect((await action(b, queued, requestId)).outcome.status).toBe("ok");
  expect(a.agents[0]?.queue).toHaveLength(1);
  a.disconnect();
  b.disconnect();
  providers[0]!.finish();
  await expect
    .poll(() => providers[0]?.requests.filter((r) => r.method === "turn/start").length)
    .toBe(2);
  const c = await open(url);
  await expect.poll(() => c.agents[0]?.status).toBe("done");
  expect(c.agents[0]?.queue).toHaveLength(0);
  const result = await action(c, { kind: "read", sessionId: id });
  if (result.outcome.status === "ok")
    expect(
      result.outcome.conversation.items.filter((i) => i.kind === "user").map((i) => i.text),
    ).toEqual(["hold this turn", "continue after disconnect"]);
});

it("pauses queued work across an interrupted daemon restart until explicitly resumed", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold before restart" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const requestId = randomUUID(),
    queued: AgentOperation = { kind: "queue-add", sessionId: id, text: "after restart" };
  await action(a, queued, requestId);
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot());
  expect(c.agents[0]).toMatchObject({ status: "interrupted", queuePaused: true });
  expect(c.agents[0]?.queue).toHaveLength(1);
  expect((await action(c, queued, requestId)).outcome.status).toBe("ok");
  expect(c.agents[0]?.queue).toHaveLength(1);
  await action(c, { kind: "queue-pause", sessionId: id, paused: false });
  await expect.poll(() => c.agents[0]?.status).toBe("done");
  expect(c.agents[0]?.queue).toHaveLength(0);
  const resumed = providers[1];
  expect(resumed?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
});

it("keeps queued attachment bytes private and removes canceled follow-ups", async () => {
  const { a, id } = await setup();
  await action(a, { kind: "queue-pause", sessionId: id, paused: true });
  const requestId = randomUUID(),
    secret = Buffer.from("private attachment fixture").toString("base64");
  const result = await action(
    a,
    {
      kind: "queue-add",
      sessionId: id,
      text: "see file",
      attachments: [{ name: "sample.txt", mime: "text/plain", data: secret }],
    },
    requestId,
  );
  expect(result.outcome.status).toBe("ok");
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(a.agents[0]?.queue?.[0]?.attachments).toEqual([
    { name: "sample.txt", mime: "text/plain" },
  ]);
  await action(a, { kind: "queue-remove", sessionId: id, id: requestId });
  await action(a, { kind: "queue-pause", sessionId: id, paused: false });
  expect(a.agents[0]?.queue).toHaveLength(0);
  expect(providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(0);
});

it("imports and forks native sessions into separate tabs without replaying a prompt", async () => {
  const { a, id } = await setup();
  const listed = await action(a, { kind: "sessions-list", sessionId: id });
  expect(listed.outcome.status).toBe("ok");
  if (listed.outcome.status === "ok")
    expect(listed.outcome.sessions?.[0]?.id).toBe("external-thread");
  const importId = randomUUID(),
    op: AgentOperation = {
      kind: "import-session",
      sessionId: id,
      nativeSessionId: "external-thread",
      expectedRevision: a.agents[0]!.revision,
    };
  await action(a, op, importId);
  await action(a, op, importId);
  await expect.poll(() => a.agents.filter((agent) => agent.status === "idle").length).toBe(2);
  expect(a.agents.some((agent) => agent.threadId === "external-thread")).toBe(true);
  expect(
    providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(0);
  const forkId = randomUUID(),
    fork: AgentOperation = {
      kind: "fork-session",
      sessionId: id,
      expectedRevision: a.agents.find((agent) => agent.id === id)!.revision,
    };
  await action(a, fork, forkId);
  await action(a, fork, forkId);
  await expect.poll(() => a.agents.filter((agent) => agent.status === "idle").length).toBe(3);
  expect(providers[0]?.requests.filter((r) => r.method === "session/fork")).toHaveLength(1);
  expect(a.workspace?.projects[0]?.tabs).toHaveLength(3);
  expect(a.workspace?.projects[0]?.tabs.map((tab) => tab.name)).toEqual(["Chat", "Tab 2", "Tab 3"]);
});

it("discovers native sessions without creating a conversation, pages past 100, and scopes search", async () => {
  vi.spyOn(ProviderRegistry.prototype, "installed").mockReturnValue(true);
  const { a } = await setup();
  const project = a.workspace!.projects[0]!;
  const op = {
    kind: "sessions-list" as const,
    projectId: project.id,
    directory,
    provider: "codex",
  };
  const first = await a.requestProvider(op, randomUUID());
  expect(first.outcome).toMatchObject({ status: "ok", sessions: { nextCursor: "100" } });
  if (first.outcome.status !== "ok") return;
  expect(first.outcome.sessions?.sessions).toHaveLength(100);
  expect(a.agents).toHaveLength(1);
  expect(providers[1]?.requests.map((r) => r.method)).toEqual(["session/list"]);
  expect(providers[1]?.closed).toBe(true);
  await a.requestProvider(op, randomUUID());
  expect(providers).toHaveLength(2);
  const second = await a.requestProvider({ ...op, cursor: "100", query: "125" }, randomUUID());
  expect(second.outcome).toMatchObject({
    status: "ok",
    sessions: {
      sessions: [{ id: "external-thread-125" }],
      nextCursor: null,
    },
  });
  expect(
    (await a.requestProvider({ ...op, directory: tmpdir() }, randomUUID())).outcome.status,
  ).toBe("error");
});

it("resumes once into an empty pane with native history and settings, without replaying a prompt", async () => {
  vi.spyOn(ProviderRegistry.prototype, "installed").mockReturnValue(true);
  const { a, b, id } = await setup();
  const project = a.workspace!.projects[0]!;
  await a.requestProvider(
    { kind: "sessions-list", projectId: project.id, directory, provider: "codex" },
    randomUUID(),
  );
  const requestId = randomUUID();
  const op = {
    kind: "resume-session" as const,
    sessionId: id,
    nativeSessionId: "external-thread",
    provider: "codex",
    expectedRevision: a.agents[0]!.revision,
  };
  const result = await action(a, op, requestId);
  expect(result.outcome.status).toBe("ok");
  if (result.outcome.status !== "ok") return;
  const resumed = result.outcome.conversation.agent.id;
  expect((await action(b, op, requestId)).outcome).toMatchObject({
    status: "ok",
    conversation: { agent: { id: resumed } },
  });
  await expect.poll(() => a.agents.find((agent) => agent.id === resumed)?.status).toBe("idle");
  expect(a.workspace!.projects[0]!.tabs).toHaveLength(1);
  expect(a.workspace!.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({ sessionId: resumed });
  const read = await action(a, { kind: "read", sessionId: resumed });
  expect(read.outcome).toMatchObject({
    status: "ok",
    conversation: { items: [{ text: "Saved CLI prompt" }, { text: "Saved CLI response" }] },
  });
  const native = providers.find((provider) =>
    provider.requests.some((r) => r.method === "thread/resume"),
  )!;
  expect(native.requests.find((r) => r.method === "thread/resume")?.params).not.toHaveProperty(
    "model",
  );
  expect(
    providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(0);
});

it("rejects unlisted native IDs and protects conversations when a stale picker is submitted", async () => {
  vi.spyOn(ProviderRegistry.prototype, "installed").mockReturnValue(true);
  const { a, id } = await setup();
  const project = a.workspace!.projects[0]!;
  const op = {
    kind: "resume-session" as const,
    sessionId: id,
    nativeSessionId: "external-thread",
    provider: "codex",
    expectedRevision: a.agents[0]!.revision,
  };
  expect((await action(a, op)).outcome.status).toBe("error");
  await a.requestProvider(
    { kind: "sessions-list", projectId: project.id, directory, provider: "codex" },
    randomUUID(),
  );
  await action(a, { kind: "send", sessionId: id, text: "Keep this conversation" });
  await expect.poll(() => a.agents[0]!.status).toBe("done");
  expect((await action(a, op)).outcome.status).toBe("error");
  expect((await action(a, { ...op, expectedRevision: a.agents[0]!.revision })).outcome.status).toBe(
    "error",
  );
  expect(a.workspace!.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({ sessionId: id });
  expect(a.agents).toHaveLength(1);
});

it("never silently replaces a missing imported session with a fresh empty thread", async () => {
  vi.spyOn(ProviderRegistry.prototype, "installed").mockReturnValue(true);
  const { a, id } = await setup("missing");
  await a.requestProvider(
    {
      kind: "sessions-list",
      projectId: a.workspace!.projects[0]!.id,
      directory,
      provider: "codex",
    },
    randomUUID(),
  );
  const result = await action(a, {
    kind: "resume-session",
    sessionId: id,
    provider: "codex",
    nativeSessionId: "external-thread",
    expectedRevision: a.agents[0]!.revision,
  });
  expect(result.outcome.status).toBe("ok");
  if (result.outcome.status !== "ok") return;
  const resumed = result.outcome.conversation.agent.id;
  await expect.poll(() => a.agents.find((agent) => agent.id === resumed)?.status).toBe("failed");
  expect(a.agents.find((agent) => agent.id === resumed)?.threadId).toBe("external-thread");
  const native = providers.find((provider) =>
    provider.requests.some((r) => r.method === "thread/resume"),
  )!;
  expect(native.requests.some((r) => r.method === "thread/start")).toBe(false);
  expect(providers[0]?.closed).toBe(true);
});

it("rewinds the selected turn only and publishes a history revision to all clients", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "first prompt" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  await action(a, { kind: "send", sessionId: id, text: "second prompt" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const read = await action(a, { kind: "read", sessionId: id });
  expect(read.outcome.status).toBe("ok");
  if (read.outcome.status !== "ok") return;
  const turnId = read.outcome.conversation.items.find((i) => i.text === "second prompt")!.turnId;
  const result = await action(a, {
    kind: "rewind",
    sessionId: id,
    turnId,
    mode: "conversation",
    expectedRevision: a.agents[0]!.revision,
  });
  expect(result.outcome.status).toBe("ok");
  if (result.outcome.status === "ok")
    expect(
      result.outcome.conversation.items.filter((i) => i.kind === "user").map((i) => i.text),
    ).toEqual(["first prompt"]);
  await expect.poll(() => b.agents[0]?.historyRevision).toBe(1);
  expect(b.agents[0]?.queuePaused).toBe(true);
  expect(providers[0]?.requests.find((r) => r.method === "session/rewind")?.params).toMatchObject({
    numTurns: 1,
  });
});

it("steers an active turn once without scheduling another turn", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold the turn" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const req = randomUUID(),
    op: AgentOperation = {
      kind: "steer",
      sessionId: id,
      turnId: a.agents[0]!.turnId!,
      text: "Focus on the parser",
    };
  expect((await action(a, op, req)).outcome.status).toBe("ok");
  await action(b, op, req);
  expect(providers[0]?.requests.filter((r) => r.method === "session/steer")).toHaveLength(1);
  expect(providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
});

it("holds the source session steady while a native fork is in flight", async () => {
  const { a, b, id } = await setup();
  const provider = providers[0]!;
  const original = provider.request.bind(provider);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(provider, "request").mockImplementation(async (method, params) => {
    if (method === "session/fork") await waiting;
    return original(method, params);
  });
  const fork = await action(a, {
    kind: "fork-session",
    sessionId: id,
    expectedRevision: a.agents[0]!.revision,
  });
  expect(fork.outcome.status).toBe("ok");
  expect(
    (await action(b, { kind: "send", sessionId: id, text: "concurrent change" })).outcome.status,
  ).toBe("error");
  expect(
    (
      await action(b, {
        kind: "fork-session",
        sessionId: id,
        expectedRevision: a.agents.find((agent) => agent.id === id)!.revision,
      })
    ).outcome.status,
  ).toBe("error");
  release();
  await expect.poll(() => a.agents.filter((agent) => agent.status === "idle").length).toBe(2);
  expect(
    (await action(b, { kind: "send", sessionId: id, text: "after fork" })).outcome.status,
  ).toBe("ok");
});

it("keeps saved history visible and retries a failed native recovery", async () => {
  const { a, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "saved prompt" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const resume = TestAgentProvider.prototype.request;
  providers[0]!.emit("session/disconnected", {});
  const spy = vi.spyOn(TestAgentProvider.prototype, "request").mockImplementation(async function (
    this: TestAgentProvider,
    method,
    params,
  ) {
    if (method === "thread/resume") throw new Error("Temporary account error");
    return resume.call(this, method, params);
  });
  try {
    const read = await action(a, { kind: "read", sessionId: id });
    expect(read.outcome.status).toBe("ok");
    if (read.outcome.status === "ok")
      expect(read.outcome.conversation.items.some((i) => i.text === "saved prompt")).toBe(true);
    await expect.poll(() => a.agents[0]?.status).toBe("failed");
  } finally {
    spy.mockRestore();
  }
  const before = providers.length;
  await action(a, { kind: "read", sessionId: id });
  expect(providers).toHaveLength(before + 1);
  expect(providers.at(-1)?.requests.some((r) => r.method === "thread/resume")).toBe(true);
});
it.each(["sign-in", "restart"])(
  "replaces an empty provider thread after %s and sends only the new prompt",
  async (reason) => {
    const { a, b, id } = await setup("missing");
    const oldThread = a.agents[0]!.threadId;
    let c = a;
    if (reason === "sign-in") {
      const flow = await action(a, {
        kind: "account",
        sessionId: id,
        action: { type: "start", methodId: "fixture" },
      });
      if (flow.outcome.status !== "ok" || !flow.outcome.account?.challenge)
        throw new Error("Missing challenge");
      const result = await action(a, {
        kind: "account",
        sessionId: id,
        action: {
          type: "complete",
          flowId: flow.outcome.account.challenge.flowId,
          value: "test-credential",
        },
      });
      expect(result.outcome.status === "ok" && result.outcome.account?.status).toBe("connected");
      expect(providers[0]!.closed).toBe(true);
    } else {
      a.disconnect();
      b.disconnect();
      await server!.close();
      c = await open(await boot("missing"));
    }
    const count = TestAgentProvider.turns;
    const requestId = randomUUID();
    const op: AgentOperation = { kind: "send", sessionId: id, text: "hello after recovery" };
    const sent = await action(c, op, requestId);
    if (sent.outcome.status === "error") throw new Error(sent.outcome.message);
    await expect.poll(() => c.agents[0]?.status).toBe("done");
    expect(c.agents[0]!.threadId).not.toBe(oldThread);
    expect(
      providers[1]!.requests.filter((r) => r.method.startsWith("thread/")).map((r) => r.method),
    ).toEqual(reason === "sign-in" ? ["thread/start"] : ["thread/resume", "thread/start"]);
    expect(providers[1]!.requests.find((r) => r.method === "turn/start")?.params).toMatchObject({
      threadId: c.agents[0]!.threadId,
      input: [{ type: "text", text: op.text }],
    });
    await action(c, op, requestId);
    expect(TestAgentProvider.turns).toBe(count + 1);
  },
);

it("preserves a signed-in conversation that already has provider history", async () => {
  const { a, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "first message" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const oldThread = a.agents[0]!.threadId;
  const flow = await action(a, {
    kind: "account",
    sessionId: id,
    action: { type: "start", methodId: "fixture" },
  });
  if (flow.outcome.status !== "ok" || !flow.outcome.account?.challenge)
    throw new Error("Missing challenge");
  await action(a, {
    kind: "account",
    sessionId: id,
    action: {
      type: "complete",
      flowId: flow.outcome.account.challenge.flowId,
      value: "test-credential",
    },
  });
  expect(a.agents[0]!.threadId).toBe(oldThread);
  expect(providers[0]!.closed).toBe(true);
  await action(a, { kind: "send", sessionId: id, text: "second message" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  expect(
    providers[1]!.requests.filter((r) => r.method.startsWith("thread/")).map((r) => r.method),
  ).toEqual(["thread/resume"]);
});

it("does not replace a missing Codex thread that has provider history", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "first message" });
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const oldThread = a.agents[0]!.threadId;
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot("missing"));
  const count = TestAgentProvider.turns;
  await action(c, { kind: "send", sessionId: id, text: "second message" });
  await expect.poll(() => c.agents[0]?.status).toBe("failed");
  expect(c.agents[0]!.threadId).toBe(oldThread);
  expect(providers[1]!.requests.some((r) => r.method === "thread/start")).toBe(false);
  expect(TestAgentProvider.turns).toBe(count);
});

it("preserves resume errors and recovers a later retry without replaying failed prompts", async () => {
  const { a, b, id } = await setup();
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot("Authentication failed"));
  const count = TestAgentProvider.turns;
  await action(c, { kind: "send", sessionId: id, text: "do not replay this" });
  await expect.poll(() => c.agents[0]?.status).toBe("failed");
  expect(c.agents[0]!.error).toBe("Authentication failed");
  expect(providers[1]!.requests.some((r) => r.method === "thread/start")).toBe(false);
  c.disconnect();
  await server!.close();
  const d = await open(await boot("missing"));
  await action(d, { kind: "send", sessionId: id, text: "only this prompt" });
  await expect.poll(() => d.agents[0]?.status).toBe("done");
  expect(TestAgentProvider.turns).toBe(count + 1);
  expect(providers[2]!.requests.find((r) => r.method === "turn/start")?.params).toMatchObject({
    input: [{ type: "text", text: "only this prompt" }],
  });
});

it("keeps invalid question replies pending, accepts optional blanks, and redacts private answers from the shared timeline", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold the turn" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const input = providers[0]!.onRequest(
    "item/tool/requestUserInput",
    {
      threadId: a.agents[0]!.threadId,
      turnId: a.agents[0]!.turnId,
      questions: [
        {
          id: "checks",
          header: "Checks",
          question: "Which checks?",
          multiSelect: true,
          allowOther: false,
          options: [
            { label: "Unit", description: "Fast" },
            { label: "Browser", description: "UI" },
          ],
        },
        { id: "secret", header: "Key", question: "Private value", isSecret: true },
        { id: "note", header: "Note", question: "Notes?", required: false },
      ],
    },
    "question",
  );
  await expect.poll(() => b.agents[0]?.pending.length).toBe(1);
  const pendingId = b.agents[0]!.pending[0]!.id;
  expect(
    (
      await action(a, {
        kind: "respond",
        sessionId: id,
        pendingId,
        answers: { checks: ["Invalid"] },
      })
    ).outcome.status,
  ).toBe("error");
  expect(b.agents[0]?.pending).toHaveLength(1);
  expect(
    (
      await action(b, {
        kind: "respond",
        sessionId: id,
        pendingId,
        answers: { checks: ["Unit", "Browser"], secret: ["private-fixture"], note: [] },
      })
    ).outcome.status,
  ).toBe("ok");
  expect(await input).toEqual({
    answers: {
      checks: { answers: ["Unit", "Browser"] },
      secret: { answers: ["private-fixture"] },
      note: { answers: [] },
    },
  });
  const read = await action(a, { kind: "read", sessionId: id });
  expect(JSON.stringify(read)).not.toContain("private-fixture");
  expect(JSON.stringify(read)).toContain("[private answer]");
});

it("preserves explicit permission actions and lets a question cancel the whole turn", async () => {
  const { a, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold the turn" });
  await expect.poll(() => a.agents[0]?.turnId?.startsWith("turn-")).toBe(true);
  const scope = { threadId: a.agents[0]!.threadId, turnId: a.agents[0]!.turnId };
  const input = providers[0]!.onRequest(
    "item/commandExecution/requestApproval",
    { ...scope, availableDecisions: ["accept", "acceptForSession", "decline", "cancel"] },
    "approval",
  );
  await expect.poll(() => a.agents[0]?.pending.length).toBe(1);
  const pendingId = a.agents[0]!.pending[0]!.id;
  expect(
    (
      await action(a, {
        kind: "respond",
        sessionId: id,
        pendingId,
        actionId: "invented",
        decision: "accept",
      })
    ).outcome.status,
  ).toBe("error");
  await action(a, {
    kind: "respond",
    sessionId: id,
    pendingId,
    actionId: "acceptForSession",
    decision: "accept",
  });
  expect(await input).toMatchObject({ decision: "acceptForSession" });
  const question = providers[0]!.onRequest(
    "item/tool/requestUserInput",
    { ...scope, questions: [{ id: "answer", header: "Question", question: "Proceed?" }] },
    "question",
  );
  await expect.poll(() => a.agents[0]?.pending.length).toBe(1);
  await action(a, {
    kind: "respond",
    sessionId: id,
    pendingId: a.agents[0]!.pending[0]!.id,
    decision: "cancel",
  });
  expect(await question).toMatchObject({ decision: "cancel" });
  await expect.poll(() => a.agents[0]?.status).toBe("interrupted");
  expect(a.agents[0]?.pending).toEqual([]);
});

it("keeps async questions across turns and restart, and durably resolves answers once", async () => {
  const { a, b, id } = await setup();
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  const provider = providers[0]!;
  const question = {
    id: "async-1",
    type: "agentMessage",
    delivery: "async",
    questions: [{ title: "Which approach?", options: ["Small change", "Full rewrite"] }],
  };
  provider.emit("item/completed", { item: question });
  await expect.poll(() => b.agents[0]?.pending.length).toBe(1);
  expect(b.agents[0]?.status).toBe("working");
  expect(b.agents[0]?.attention?.kind).toBe("needs_input");
  provider.finish();
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  await action(a, { kind: "send", sessionId: id, text: "hold again" });
  expect(a.agents[0]?.pending).toHaveLength(1);
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot());
  expect(c.agents[0]?.pending).toHaveLength(1);
  const pending = c.agents[0]!.pending[0]!;
  const op: AgentOperation = {
    kind: "respond",
    sessionId: id,
    pendingId: pending.id,
    answers: { "0": ["Small change"] },
  };
  const requestId = randomUUID();
  expect((await action(c, op, requestId)).outcome.status).toBe("ok");
  expect((await action(c, op, requestId)).outcome.status).toBe("ok");
  expect(c.agents[0]?.queue).toHaveLength(1);
  expect(c.agents[0]?.pending).toHaveLength(0);
  const history = await action(c, { kind: "read", sessionId: id });
  expect(
    history.outcome.status === "ok" &&
      history.outcome.conversation.items.some((i) => i.id === "async-response:async-1"),
  ).toBe(true);
  await action(c, { kind: "send", sessionId: id, text: "hold resumed" });
  providers.at(-1)!.emit("item/completed", { item: question });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(c.agents[0]?.pending).toHaveLength(0);
});

it("implements only the current completed plan and keeps normal tool permissions", async () => {
  const { a, id } = await setup();
  let info = a.agents[0]!;
  await action(a, {
    kind: "configure",
    sessionId: id,
    expectedRevision: info.revision,
    settings: { model: "fixture", effort: "high", mode: "default", planMode: true },
  });
  await action(a, { kind: "send", sessionId: id, text: "hold" });
  providers[0]!.emit("item/completed", {
    item: { id: "proposal", type: "plan", text: "## Plan\n\nAdd a test, then implement." },
  });
  providers[0]!.finish();
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  info = a.agents[0]!;
  const op: AgentOperation = {
    kind: "implement-plan",
    sessionId: id,
    expectedRevision: info.revision,
    itemId: "proposal",
  };
  expect((await action(a, { ...op, expectedRevision: info.revision - 1 })).outcome.status).toBe(
    "error",
  );
  const requestId = randomUUID();
  expect((await action(a, op, requestId)).outcome.status).toBe("ok");
  expect((await action(a, op, requestId)).outcome.status).toBe("ok");
  await expect
    .poll(() => providers[0]!.requests.filter((r) => r.method === "turn/start").length)
    .toBe(2);
  expect(providers[0]!.requests.filter((r) => r.method === "turn/start")[1]?.params).toMatchObject({
    collaborationMode: { mode: "default" },
    sandboxPolicy: { type: "workspaceWrite" },
    input: [
      { type: "text", text: "Implement this plan:\n\n## Plan\n\nAdd a test, then implement." },
    ],
  });
});

it("previews submitted attachments after restart without broadcasting the bytes in timeline items", async () => {
  const { a, b, id } = await setup();
  const requestId = randomUUID(),
    data = Buffer.from("# Attached document").toString("base64");
  await action(
    a,
    {
      kind: "send",
      sessionId: id,
      text: "Read the attachment",
      attachments: [{ name: "notes.md", mime: "text/markdown", data }],
    },
    requestId,
  );
  await expect.poll(() => a.agents[0]?.status).toBe("done");
  const read = await action(b, { kind: "read", sessionId: id });
  expect(
    read.outcome.status === "ok" && read.outcome.conversation.items.find((i) => i.kind === "user"),
  ).toMatchObject({
    text: "Read the attachment",
    attachments: [{ name: "notes.md", mime: "text/markdown" }],
  });
  expect(JSON.stringify(read)).not.toContain(data);
  a.disconnect();
  b.disconnect();
  await server!.close();
  const c = await open(await boot());
  const result = await action(c, {
    kind: "read-attachment",
    sessionId: id,
    itemId: `prompt:${requestId}`,
    index: 0,
  });
  expect(result.outcome.status === "ok" && result.outcome.attachment).toEqual({
    name: "notes.md",
    mime: "text/markdown",
    data,
  });
  expect(
    (
      await action(c, {
        kind: "read-attachment",
        sessionId: id,
        itemId: `prompt:${requestId}`,
        index: 1,
      })
    ).outcome.status,
  ).toBe("error");
  expect(
    (await action(c, { kind: "read-attachment", sessionId: id, itemId: "/etc/passwd", index: 0 }))
      .outcome.status,
  ).toBe("error");
});
