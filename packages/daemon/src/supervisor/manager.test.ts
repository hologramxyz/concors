import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  SupervisorControlSchema,
  AgentOperation,
  SupervisorDelivery,
} from "@concors/protocol";
import type { z } from "zod";
import { WorkspaceStore } from "../workspace/store.ts";
import { AgentManager } from "../agents/manager.ts";
import { ProviderRegistry } from "../agents/providers/registry.ts";
import { TestAgentProvider } from "../agents/testing/provider.ts";
import { SupervisorManager } from "./manager.ts";
import { SupervisorTools } from "./tools.ts";
import { WATCH_LIMIT } from "./watch.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "concors-supervisor-"));
  const store = new WorkspaceStore(join(directory, "workspace.sqlite"));
  const registry = new ProviderRegistry(join(directory, "providers"));
  vi.spyOn(registry, "installed").mockReturnValue(true);
  const providers: TestAgentProvider[] = [];
  let manager: SupervisorManager | undefined;
  const agents = new AgentManager(
    store,
    (event) => {
      queueMicrotask(() => manager?.observe(event));
    },
    () => undefined,
    (cwd, handler, id) => {
      const provider = new TestAgentProvider(handler, id);
      provider.cwd = cwd;
      providers.push(provider);
      return provider;
    },
    registry,
    undefined,
    // As the daemon wires it: Supervisor's own tool server is preapproved.
    (info) =>
      info.supervisor
        ? {
            mcp: { name: "concors-supervisor", type: "http", url: "http://127.0.0.1:9/mcp" },
            preapproved: true,
          }
        : {},
  );
  const createManager = () =>
    new SupervisorManager(
      store,
      agents,
      registry,
      () => undefined,
      (command) => store.execute(command, { preserveSelection: true }).result,
    );
  manager = createManager();
  const projectId = randomUUID();
  store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: store.snapshot().epoch,
    operation: { kind: "project.add", projectId, name: "App", directory },
  });
  const project = store.ensureSupervisor(),
    tab = project.tabs[0]!,
    pane = tab.nodes[0]!;
  const request = (operation: AgentOperation) =>
    agents.request({ type: "agent.request", requestId: randomUUID(), operation });
  const start = await request({
    kind: "start",
    epoch: store.snapshot().epoch,
    expectedVersion: project.version,
    projectId: project.id,
    tabId: tab.id,
    paneId: pane.id,
    provider: "codex",
  });
  expect(start.outcome).toMatchObject({ status: "ok" });
  const source = store.agents().find((a) => a.supervisor)!;
  await expect.poll(() => store.agent(source.id).status).toBe("idle");
  cleanups.push(async () => {
    manager?.close();
    manager = undefined;
    await agents.close();
    registry.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    registry,
    agents,
    providers,
    projectId,
    source,
    request,
    get manager() {
      return manager!;
    },
    control: (
      operation: z.input<typeof SupervisorControlSchema>["operation"],
      requestId = randomUUID(),
    ) => manager!.control(source.id, { requestId, operation }),
    target: () => agents.startScheduled(randomUUID(), projectId, "claude", "fixture-claude"),
    restart: () => {
      manager!.close();
      manager = createManager();
    },
  };
}
it("keeps one durable binding outside workspaces and preserves it through /clear", async () => {
  const f = await setup();
  const project = f.store.ensureSupervisor();
  expect(f.store.ensureSupervisor()).toEqual(project);
  expect(f.store.snapshot().projects.map((p) => p.name)).toEqual(["App"]);
  expect(
    (await f.request({ kind: "send", sessionId: f.source.id, text: "/clear" })).outcome.status,
  ).toBe("ok");
  await expect.poll(() => f.store.agents().filter((a) => a.supervisor).length).toBe(2);
  const current = f.store.snapshot().supervisor!.tabs[0]!.nodes[0]!;
  expect(current.kind === "pane" && current.sessionId).not.toBe(f.source.id);
  await expect(f.control({ kind: "workspaces" })).rejects.toThrow("no longer selected");
});
it("searches saved content without launching a provider and rejects non-supervisor callers", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "Payment receipt regression" });
  await expect.poll(() => f.store.agent(target.id).status).toBe("done");
  const count = f.providers.length;
  expect(await f.control({ kind: "sessions", query: "receipt", offset: 0 })).toMatchObject({
    sessions: [{ id: target.id }],
  });
  expect(await f.control({ kind: "read", sessionId: target.id })).toMatchObject({
    sessionId: target.id,
    items: expect.arrayContaining([
      expect.objectContaining({ text: "Payment receipt regression" }),
    ]),
  });
  expect(f.providers).toHaveLength(count);
  await expect(
    f.manager.control(target.id, { requestId: randomUUID(), operation: { kind: "workspaces" } }),
  ).rejects.toThrow("Supervisor conversation");
});
it("delivers once, attributes the message and follows completion without a connected client", async () => {
  const f = await setup(),
    target = await f.target(),
    requestId = randomUUID();
  const operation = {
    kind: "send" as const,
    sessionId: target.id,
    text: "Review changes",
    whenBusy: "queue" as const,
  };
  const [first, second] = (await Promise.all([
    f.control(operation, requestId),
    f.control(operation, requestId),
  ])) as { delivery: { id: string } }[];
  expect(second).toEqual(first);
  const deliveryId = first!.delivery.id;
  // The delivery is named by the daemon, not after the model's request ID.
  expect(deliveryId).not.toBe(requestId);
  await expect.poll(() => f.manager.deliveries()[0]?.status).toBe("done");
  await f.control(operation, requestId);
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
  expect(f.store.supervisorPrompt(target.id, deliveryId)?.origin).toEqual({
    supervisorId: f.source.id,
    deliveryId,
  });
  const watched = f.store.supervisorRecord(`watch:${f.source.id}:${target.id}`) as { id: string };
  expect(
    f.store
      .agentConversation(f.source.id)
      .items.filter((i) => i.title === "Agent result" && i.origin?.deliveryId === watched.id),
  ).toHaveLength(1);
  await expect(f.control({ ...operation, text: "different" }, requestId)).rejects.toThrow(
    "already used",
  );
});
it("queues behind busy work and follows the delivered turn rather than the previous completion", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold original work" });
  await expect.poll(() => f.store.agent(target.id).status).toBe("working");
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "hold follow-up",
    whenBusy: "queue",
  });
  expect(f.manager.deliveries()[0]?.status).toBe("queued");
  f.providers.at(-1)!.finish();
  await expect.poll(() => f.manager.deliveries()[0]?.status).toBe("working");
  f.providers.at(-1)!.finish();
  await expect.poll(() => f.manager.deliveries()[0]?.status).toBe("done");
});
it("exposes pending approvals without answering them and checks recipient grants on dispatch", async () => {
  const f = await setup(),
    target = await f.target();
  f.store.saveAgent({
    ...f.store.agent(f.source.id),
    supervisorSharing: { revision: f.registry.revision, providers: ["codex"] },
  });
  await expect(
    f.control({ kind: "send", sessionId: target.id, text: "Review", whenBusy: "queue" }),
  ).rejects.toThrow("sharing permission");
  f.store.saveAgent({ ...f.store.agent(f.source.id), supervisorSharing: undefined });
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "approve this command",
    whenBusy: "queue",
  });
  await expect.poll(() => f.manager.deliveries()[0]?.status).toBe("needs_input");
  expect(f.store.agent(target.id).pending).toHaveLength(1);
  f.manager.request({
    type: "supervisor.request",
    requestId: randomUUID(),
    operation: { kind: "revoke-sharing" },
  });
  await expect(f.control({ kind: "workspaces" })).rejects.toThrow("withdrawn");
});
it("does not replay uncertain mutations after restart", async () => {
  const f = await setup(),
    target = await f.target();
  await f.control({ kind: "send", sessionId: target.id, text: "hold", whenBusy: "queue" });
  const requestId = randomUUID(),
    operation = { kind: "send", sessionId: target.id, text: "Never replay", whenBusy: "queue" };
  const id = randomUUID();
  // Handed to the target, with no result recorded: it may have been delivered.
  f.store.saveSupervisorRecord(`request:${f.source.id}:${requestId}`, {
    sessionId: f.source.id,
    request: { requestId, operation },
    id,
    createdAt: new Date().toISOString(),
    agentRequest: {
      type: "agent.request",
      requestId: id,
      operation: { kind: "send", sessionId: target.id, text: "Never replay" },
    },
  });
  f.restart();
  expect(f.manager.deliveries()[0]?.status).toBe("interrupted");
  await expect(f.manager.control(f.source.id, { requestId, operation })).rejects.toThrow(
    "interrupted",
  );
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
});
it("never adopts an existing chat when the model reuses a session ID as its request ID", async () => {
  const f = await setup(),
    existing = await f.target();
  const started = (await f.manager.control(f.source.id, {
    requestId: existing.id,
    operation: { kind: "start", projectId: f.projectId, provider: "claude", name: "Fresh" },
  })) as { sessionId: string };
  expect(started.sessionId).not.toBe(existing.id);
  expect(f.store.agent(started.sessionId)).toMatchObject({ projectId: f.projectId, name: "Fresh" });
  expect(f.store.agent(existing.id).name).toBe(existing.name);
});
it("answers reads from current state even when a request ID repeats, and needs no ID", async () => {
  const f = await setup(),
    target = await f.target(),
    requestId = randomUUID();
  expect(await f.control({ kind: "status" }, requestId)).toMatchObject({ watching: [] });
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  expect(await f.control({ kind: "status" }, requestId)).toMatchObject({
    watching: [{ sessionId: target.id }],
  });
  expect(
    await f.manager.control(f.source.id, { operation: { kind: "sessions", offset: 0 } }),
  ).toMatchObject({ sessions: [{ id: target.id }] });
  // Without a request ID a change still happens, once per call.
  await f.manager.control(f.source.id, {
    operation: { kind: "send", sessionId: target.id, text: "First", whenBusy: "queue" },
  });
  await expect.poll(() => f.store.agent(target.id).status).toBe("done");
  expect(f.store.supervisorRecords("request:")).toHaveLength(0);
});
it("limits watches per conversation, makes room from settled chats and lets /clear move on", async () => {
  const f = await setup(),
    target = await f.target();
  await expect.poll(() => f.store.agent(target.id).status).toBe("idle");
  // Saved chats a Supervisor followed, without running a provider for each.
  const followed = (
    supervisorId: string,
    count: number,
    status: "done" | "working",
    explicit = false,
  ) =>
    // One transaction: hundreds of separate writes take several seconds on Windows runners.
    f.store.transaction(() =>
      Array.from({ length: count }, (_, index) => {
        const id = randomUUID();
        f.store.createBackgroundAgent({
          ...f.store.agent(target.id),
          id,
          status,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        });
        f.store.saveSupervisorRecord(`watch:${supervisorId}:${id}`, {
          id: randomUUID(),
          supervisorId,
          sessionId: id,
          enabled: true,
          explicit,
        });
        return id;
      }),
    );
  // Chats the user asked to watch are never dropped to make room, however long idle.
  const asked = followed(f.source.id, 1, "done", true);
  const old = followed(f.source.id, WATCH_LIMIT - 1, "done");
  // At the limit, the chat idle longest makes room.
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  expect(f.store.supervisorRecord(`watch:${f.source.id}:${old[0]}`)).toMatchObject({
    enabled: false,
  });
  expect(f.store.supervisorRecord(`watch:${f.source.id}:${asked[0]}`)).toMatchObject({
    enabled: true,
  });
  expect(f.store.keepsAgent(old[1]!)).toBe(false);
  expect(f.store.keepsAgent(f.source.id)).toBe(true);
  await f.request({ kind: "send", sessionId: f.source.id, text: "/clear" });
  await expect.poll(() => f.store.agents().filter((a) => a.supervisor).length).toBe(2);
  const pane = f.store.snapshot().supervisor!.tabs[0]!.nodes[0]!;
  const next = pane.kind === "pane" ? pane.sessionId! : "";
  // The cleared conversation is no longer kept, nor counts against the new one.
  expect(f.store.keepsAgent(f.source.id)).toBe(false);
  expect(f.store.keepsAgent(next)).toBe(true);
  const busy = followed(next, WATCH_LIMIT - 1, "working");
  const watched = followed(next, 1, "done", true);
  expect(f.store.keepsAgent(busy[0]!)).toBe(true);
  await expect(
    f.manager.control(next, { operation: { kind: "watch", sessionId: target.id } }),
  ).rejects.toThrow("Stop watching one first");
  expect(f.store.supervisorRecord(`watch:${next}:${watched[0]}`)).toMatchObject({
    enabled: true,
  });
});
it("prunes old receipts and delivery history on restart and skips streamed text", async () => {
  const f = await setup(),
    target = await f.target();
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  f.store.saveSupervisorRecord(`request:${randomUUID()}`, { result: "unscoped, older daemon" });
  f.store.saveSupervisorRecord(`request:${f.source.id}:${randomUUID()}`, { createdAt: old });
  const fresh = `request:${f.source.id}:${randomUUID()}`;
  f.store.saveSupervisorRecord(fresh, { createdAt: new Date().toISOString() });
  f.store.saveSupervisorRecord(`watch:${f.source.id}:${randomUUID()}`, { enabled: false });
  f.store.transaction(() => {
    for (let index = 0; index < 300; index++) {
      const id = randomUUID(),
        at = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      f.store.saveSupervisorRecord("delivery:" + id, {
        id,
        supervisorId: f.source.id,
        sessionId: target.id,
        projectId: f.projectId,
        text: "Earlier work",
        status: "done",
        createdAt: at,
        updatedAt: at,
      });
    }
  });
  f.restart();
  expect(f.store.supervisorRecords("request:")).toHaveLength(1);
  expect(f.store.supervisorRecord(fresh)).toBeDefined();
  expect(f.store.supervisorRecords("watch:")).toHaveLength(0);
  expect(f.store.supervisorRecords("delivery:")).toHaveLength(256);
  expect(f.manager.deliveries()).toHaveLength(128);
  // Streamed reply text reads neither deliveries nor the chat's saved state.
  const item = {
    ...f.store.agentConversation(target.id).items[0]!,
    sessionId: target.id,
    kind: "assistant" as const,
  };
  const reads = vi.spyOn(f.store, "supervisorRecords"),
    agents = vi.spyOn(f.store, "agent");
  f.manager.observe({ type: "agent.item", item });
  expect(reads.mock.calls.filter(([prefix]) => prefix !== "watch:")).toEqual([]);
  expect(agents).not.toHaveBeenCalled();
  // Once a chat is known to be working, its streamed text reads nothing at all.
  f.manager.observe({
    type: "agent.state",
    agent: { ...f.store.agent(target.id), status: "working" },
  });
  reads.mockClear();
  agents.mockClear();
  f.manager.observe({ type: "agent.item", item });
  expect(reads).not.toHaveBeenCalled();
  expect(agents).not.toHaveBeenCalled();
});
it("searches a history longer than one slice without blocking", async () => {
  const f = await setup(),
    target = await f.target(),
    other = await f.target();
  const item = (sessionId: string, index: number, text: string) =>
    f.store.saveAgentItem({
      id: `bulk:${index}`,
      sessionId,
      turnId: "bulk",
      position: 0,
      revision: 0,
      kind: "assistant",
      title: "",
      text,
      detail: "",
      status: "completed",
      createdAt: new Date().toISOString(),
    });
  // One transaction: saving 4,500 items one by one takes over a minute on Windows runners.
  const database = new DatabaseSync(join(f.directory, "workspace.sqlite"));
  database.exec("BEGIN");
  const insert = database.prepare(
    "INSERT INTO agent_items (session_id, item_id, item) VALUES (?, ?, ?)",
  );
  for (let index = 0; index < 4500; index++)
    insert.run(
      other.id,
      `bulk:${index}`,
      JSON.stringify({ kind: "assistant", text: "Unrelated progress " + index }),
    );
  // Retired chats leave positions unused: a gap of fifty million must not cost a slice per range.
  database.exec("UPDATE sqlite_sequence SET seq = seq + 50000000 WHERE name = 'agent_items'");
  database.exec("COMMIT");
  database.close();
  item(target.id, 4500, "The flaky Payment Webhook test");
  const yields = vi.spyOn(globalThis, "setImmediate");
  expect([...(await f.store.searchAgentText("payment webhook"))]).toEqual([target.id]);
  expect(yields.mock.calls.length).toBeLessThanOrEqual(3);
});
it("reports the permission mode each chat runs in, including a harness's own", async () => {
  const f = await setup(),
    target = await f.target();
  expect(await f.control({ kind: "capabilities" })).toMatchObject({ permissions: "default" });
  f.store.saveAgent({
    ...f.store.agent(f.source.id),
    settings: { model: null, effort: null, mode: "full-access" },
  });
  const claude = f.store.agent(target.id);
  f.store.saveAgent({
    ...claude,
    settings: { ...claude.settings!, mode: "default", nativeMode: "bypassPermissions" },
    controls: {
      ...claude.controls!,
      modes: [{ id: "bypassPermissions", label: "Bypass permissions" }],
    },
  });
  expect(await f.control({ kind: "capabilities" })).toMatchObject({
    permissions: "full-access",
  });
  expect(await f.control({ kind: "sessions", offset: 0 })).toMatchObject({
    sessions: [{ id: target.id, permissions: "Bypass permissions (bypassPermissions)" }],
  });
});
it("steers a just-sent turn once it has started, and reports how the instruction went", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold long essay" });
  await expect.poll(() => f.store.agent(target.id).turnId?.startsWith("pending:")).toBe(false);
  const started = f.store.agent(target.id);
  // The moment between sending and the provider starting the turn.
  f.store.saveAgent({ ...started, turnId: "pending:" + randomUUID() });
  const requests = vi.spyOn(f.agents, "request");
  const steering = f.control({
    kind: "send",
    sessionId: target.id,
    text: "Make it about multiplication",
    whenBusy: "steer",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(requests.mock.calls.filter(([r]) => r.operation.kind === "steer")).toEqual([]);
  f.store.saveAgent({ ...f.store.agent(target.id), turnId: started.turnId });
  expect(await steering).toMatchObject({ delivered: "steered" });
  expect(
    requests.mock.calls.find(([r]) => r.operation.kind === "steer")?.[0].operation,
  ).toMatchObject({ turnId: started.turnId });
  f.providers.at(-1)!.finish();
  await expect.poll(() => f.store.agent(target.id).status).toBe("done");
  // With nothing left to steer, the instruction simply starts the next turn.
  expect(
    await f.control({ kind: "send", sessionId: target.id, text: "Summarize", whenBusy: "steer" }),
  ).toMatchObject({ delivered: "sent" });
});
it("lets Supervisor use its own tool without asking while its other tools still ask", async () => {
  const f = await setup();
  const changed = await f.request({
    kind: "switch-provider",
    sessionId: f.source.id,
    provider: "claude",
    model: null,
    expectedRevision: f.store.agent(f.source.id).revision,
  });
  if (changed.outcome.status !== "ok") throw new Error("Could not switch to Claude Code");
  const id = changed.outcome.conversation.agent.id;
  await expect.poll(() => f.store.agent(id).status).toBe("idle");
  await f.request({ kind: "send", sessionId: id, text: "hold while coordinating" });
  await expect.poll(() => f.store.agent(id).turnId?.startsWith("pending:")).toBe(false);
  const provider = f.providers.at(-1)!;
  const ask = (reason: string) =>
    provider.onRequest(
      "item/commandExecution/requestApproval",
      {
        threadId: f.store.agent(id).threadId,
        turnId: f.store.agent(id).turnId,
        reason,
        command: "{}",
        availableDecisions: ["accept", "decline", "cancel"],
      },
      randomUUID(),
    );
  expect(await ask("mcp__concors-supervisor__concors_control")).toMatchObject({
    decision: "accept",
  });
  expect(f.store.agent(id).pending).toEqual([]);
  void ask("Bash").catch(() => undefined);
  await expect
    .poll(() => f.store.agent(id).pending.map((p) => p.summary))
    .toEqual([expect.stringContaining("Bash")]);
});
it("limits unfinished deliveries per conversation and bounds their history while running", async () => {
  const f = await setup(),
    target = await f.target();
  // Deliveries as the manager records them while the daemon runs.
  const record = (supervisorId: string, status: "queued" | "done", index: number) => {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    (f.manager as unknown as { saveDelivery(d: SupervisorDelivery): void }).saveDelivery({
      id: randomUUID(),
      supervisorId,
      sessionId: target.id,
      projectId: f.projectId,
      text: "Earlier work",
      status,
      createdAt: at,
      updatedAt: at,
    });
  };
  // A conversation cleared earlier left 64 deliveries unfinished.
  const earlier = randomUUID();
  // One transaction: hundreds of separate writes take several seconds on Windows runners.
  f.store.transaction(() => {
    for (let index = 0; index < 64; index++) record(earlier, "queued", index);
    for (let index = 0; index < 300; index++) record(f.source.id, "done", 100 + index);
  });
  expect(
    (f.store.supervisorRecords("delivery:") as { status: string }[]).filter(
      (d) => d.status === "done",
    ),
  ).toHaveLength(256);
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "Still possible",
    whenBusy: "queue",
  });
  f.store.transaction(() => {
    for (let index = 0; index < 64; index++) record(f.source.id, "queued", 500 + index);
  });
  await expect(
    f.control({ kind: "send", sessionId: target.id, text: "One too many", whenBusy: "queue" }),
  ).rejects.toThrow("Wait for existing delegated work");
});
it("runs again a send that stopped before anything left the daemon", async () => {
  const f = await setup(),
    target = await f.target(),
    requestId = randomUUID(),
    operation = { kind: "send", sessionId: target.id, text: "Retry me", whenBusy: "steer" };
  // Stopped while waiting for a turn to start: the receipt has no request for the target yet.
  f.store.saveSupervisorRecord(`request:${f.source.id}:${requestId}`, {
    sessionId: f.source.id,
    request: { requestId, operation },
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  f.restart();
  expect(await f.manager.control(f.source.id, { requestId, operation })).toMatchObject({
    delivered: "sent",
  });
  await expect.poll(() => f.store.agent(target.id).status).toBe("done");
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
});
it("briefs each session's latest reply for Overview without reaching a model", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "Summarize the release" });
  await expect.poll(() => f.store.agent(target.id).status).toBe("done");
  const calls = f.providers.flatMap((p) => p.requests).length;
  const result = f.manager.request({
    type: "supervisor.request",
    requestId: randomUUID(),
    operation: { kind: "briefs", sessionIds: [target.id, f.source.id, randomUUID()] },
  });
  if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
  // Supervisor's own conversation and unknown sessions are left out.
  expect(result.outcome.briefs).toEqual([
    {
      sessionId: target.id,
      turnId: f.store.agent(target.id).turnId,
      prompt: "Summarize the release",
      reply: expect.stringMatching(/\S/),
    },
  ]);
  expect(f.providers.flatMap((p) => p.requests)).toHaveLength(calls);
});
it("authenticates the local bridge and refuses browser origins and oversized bodies", async () => {
  const f = await setup(),
    tools = new SupervisorTools();
  await tools.start(f.manager);
  cleanups.push(() => tools.close());
  expect(tools.context(await f.target())).toEqual({});
  const context = tools.context(f.source),
    url = context.env!["CONCORS_CONTROL_URL"]!;
  const headers = {
    Authorization: `Bearer ${context.env!["CONCORS_CONTROL_TOKEN"]}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({ requestId: randomUUID(), operation: { kind: "workspaces" } });
  expect((await fetch(url, { method: "POST", body })).status).toBe(401);
  expect(
    (
      await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://example.com" },
        body,
      })
    ).status,
  ).toBe(401);
  const valid = await fetch(url, { method: "POST", headers, body });
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({ workspaces: [{ id: f.projectId }] });
  expect((await fetch(url, { method: "POST", headers, body: "x".repeat(65537) })).status).toBe(413);
});

it("negotiates the native MCP contract and executes the same authenticated operations", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f = await setup(),
    bridge = new SupervisorTools();
  await bridge.start(f.manager);
  cleanups.push(() => bridge.close());
  const context = bridge.context(f.source);
  const client = new Client({ name: "supervisor-test", version: "1.0.0" });
  cleanups.push(() => client.close());
  if (!context.mcp || context.mcp.type === "stdio") throw new Error("Expected HTTP MCP");
  const transport = new StreamableHTTPClientTransport(new URL(context.mcp.url), {
    requestInit: { headers: context.mcp.headers ?? {} },
  });
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["concors_control"]);
  const result = await client.callTool({
    name: "concors_control",
    arguments: { requestId: randomUUID(), operation: { kind: "workspaces" } },
  });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result.content)).toContain(f.projectId);
});

it("keeps local selection when opening a delegated chat and requires workspace versions", async () => {
  const f = await setup(),
    target = await f.target();
  const selection = f.store.snapshot().selection;
  await f.control({ kind: "open-session", sessionId: target.id });
  expect(f.store.snapshot().selection).toEqual(selection);
  expect(f.store.snapshot().projects[0]!.tabs).toHaveLength(1);
  const project = f.store.snapshot().projects[0]!;
  const result = await f.control({
    kind: "workspace",
    command: {
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: f.store.snapshot().epoch,
      operation: {
        kind: "project.rename",
        projectId: project.id,
        name: "Renamed",
        expectedVersion: project.version + 1,
      },
    },
  });
  expect(result).toMatchObject({ outcome: { status: "rejected" } });
  expect(f.store.snapshot().projects[0]!.name).toBe("App");
});

it("keeps queued delegation paused when iOS permission is withdrawn before delivery", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold original" });
  await f.control({ kind: "send", sessionId: target.id, text: "Do this later", whenBusy: "queue" });
  f.manager.request({
    type: "supervisor.request",
    requestId: randomUUID(),
    operation: { kind: "revoke-sharing" },
  });
  f.providers.at(-1)!.finish();
  await expect.poll(() => f.store.agent(target.id).queuePaused).toBe(true);
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
  expect(f.store.agent(target.id).error).toContain("sharing permission");
});

it("can send after changing harness and restores the earlier Supervisor conversation", async () => {
  const f = await setup();
  const changed = await f.request({
    kind: "switch-provider",
    sessionId: f.source.id,
    provider: "claude",
    model: null,
    expectedRevision: f.store.agent(f.source.id).revision,
  });
  expect(changed.outcome.status).toBe("ok");
  if (changed.outcome.status !== "ok") throw new Error(changed.outcome.message);
  const id = changed.outcome.conversation.agent.id;
  await expect.poll(() => f.store.agent(id).status).toBe("idle");
  const sent = await f.request({ kind: "send", sessionId: id, text: "Review this workspace" });
  expect(sent.outcome.status).toBe("ok");
  await expect.poll(() => f.store.agent(id).status).toBe("done");
  await expect(f.control({ kind: "workspaces" })).rejects.toThrow("no longer selected");
  const restored = await f.request({
    kind: "switch-provider",
    sessionId: id,
    provider: "codex",
    model: null,
    expectedRevision: f.store.agent(id).revision,
  });
  expect(restored.outcome).toMatchObject({
    status: "ok",
    conversation: { agent: { id: f.source.id, supervisor: true } },
  });
  expect(
    (await f.request({ kind: "send", sessionId: f.source.id, text: "Read the results" })).outcome
      .status,
  ).toBe("ok");
});

it("persists the binding across reopening and protects Supervisor stores from older daemons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-supervisor-migration-"));
  const path = join(directory, "workspace.sqlite");
  let store = new WorkspaceStore(path);
  const database = new DatabaseSync(path);
  try {
    expect(database.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(4);
    const project = store.ensureSupervisor();
    expect(database.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(5);
    store.close();
    store = new WorkspaceStore(path);
    expect(store.ensureSupervisor()).toEqual(project);
    expect(store.snapshot().projects).toEqual([]);
    expect(database.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(5);
  } finally {
    database.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("reports the approval blocking a queued instruction, with its command and chat link", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "approve original work" });
  await expect.poll(() => f.store.agent(target.id).pending.length).toBe(1);
  const pending = f.store.agent(target.id).pending[0]!;
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "Review after this",
    whenBusy: "queue",
  });
  expect(f.manager.deliveries()[0]?.status).toBe("queued");
  const notices = f.store
    .agentConversation(f.source.id)
    .items.filter((i) => i.title === "Agent needs your input");
  expect(notices).toHaveLength(1);
  expect(notices[0]?.text).toContain("needs your approval");
  expect(notices[0]?.text).toContain("echo test");
  expect(notices[0]?.text).toContain(`concors://session/${target.id}`);
  expect(notices[0]?.text).toContain("queued behind it");
  expect(f.store.agent(target.id).pending[0]?.id).toBe(pending.id);
  expect(await f.control({ kind: "status" })).toMatchObject({
    watching: [{ sessionId: target.id, pending: [{ id: pending.id, kind: "approval" }] }],
  });
});

it("watches existing work, waits on native events and copies the final reply without another prompt", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold game logic" });
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  const count = f.providers
    .flatMap((p) => p.requests)
    .filter((r) => r.method === "turn/start").length;
  const waiting = f.control({ kind: "wait", sessionIds: [target.id], timeoutMs: 1000 });
  f.providers.at(-1)!.emit("item/completed", {
    item: {
      id: "final-game-reply",
      type: "agentMessage",
      text: "Game logic is ready: 4 levels and score tracking.",
    },
  });
  f.providers.at(-1)!.finish();
  expect(await waiting).toMatchObject({
    timedOut: false,
    sessions: [
      {
        sessionId: target.id,
        status: "done",
        reply: { text: "Game logic is ready: 4 levels and score tracking." },
      },
    ],
  });
  await expect
    .poll(() =>
      f.store
        .agentConversation(f.source.id)
        .items.some((i) => i.title === "Agent result" && i.text.includes("4 levels")),
    )
    .toBe(true);
  f.restart();
  expect(await f.control({ kind: "status" })).toMatchObject({
    watching: [{ sessionId: target.id, status: "done" }],
  });
  f.manager.observe({ type: "agent.state", agent: f.store.agent(target.id) });
  expect(
    f.store.agentConversation(f.source.id).items.filter((i) => i.title === "Agent result"),
  ).toHaveLength(1);
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(count);
});

it("reports each distinct approval in a turn and stops reporting after unwatch", async () => {
  const f = await setup(),
    target = await f.target();
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  await f.request({ kind: "send", sessionId: target.id, text: "hold game review" });
  const turnId = f.store.agent(target.id).turnId!;
  const pending = (id: string) => ({
    id,
    turnId,
    kind: "approval" as const,
    title: "Run checks",
    summary: "node --test",
    detail: "",
    decisions: ["accept" as const],
    questions: [],
  });
  for (const id of [randomUUID(), randomUUID()]) {
    f.store.saveAgent({
      ...f.store.agent(target.id),
      status: "needs_input",
      pending: [pending(id)],
    });
    f.manager.observe({ type: "agent.state", agent: f.store.agent(target.id) });
  }
  expect(
    f.store.agentConversation(f.source.id).items.filter((i) => i.id.includes(":input:")),
  ).toHaveLength(2);
  await f.control({ kind: "watch", sessionId: target.id, enabled: false });
  f.store.saveAgent({
    ...f.store.agent(target.id),
    status: "needs_input",
    pending: [pending(randomUUID())],
  });
  f.manager.observe({ type: "agent.state", agent: f.store.agent(target.id) });
  expect(
    f.store.agentConversation(f.source.id).items.filter((i) => i.id.includes(":input:")),
  ).toHaveLength(2);
});

it("bounds waits and rechecks sharing before returning deferred context", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold game rendering" });
  expect(await f.control({ kind: "wait", sessionIds: [target.id], timeoutMs: 1 })).toMatchObject({
    timedOut: true,
    sessions: [{ status: "working" }],
  });
  const waiting = f.control({ kind: "wait", sessionIds: [target.id], timeoutMs: 20 });
  f.manager.request({
    type: "supervisor.request",
    requestId: randomUUID(),
    operation: { kind: "revoke-sharing" },
  });
  await expect(waiting).rejects.toThrow("withdrawn");
});

it("starts named chats in background tabs without stealing the user's selection", async () => {
  const f = await setup();
  const selection = f.store.snapshot().selection;
  const result = (await f.control({
    kind: "start",
    projectId: f.projectId,
    provider: "claude",
    name: "Game logic",
    open: true,
  })) as { sessionId: string };
  const project = f.store.snapshot().projects.find((p) => p.id === f.projectId)!;
  expect(project.tabs).toHaveLength(1);
  expect(project.tabs[0]?.name).toBe("Game logic");
  expect(
    project.tabs[0]?.nodes.some((n) => n.kind === "pane" && n.sessionId === result.sessionId),
  ).toBe(true);
  expect(f.store.snapshot().selection).toEqual(selection);
  expect(f.store.agent(result.sessionId).settings?.mode).toBe("default");
});

it("can wait for an existing approval to be answered without answering it", async () => {
  const f = await setup(),
    target = await f.target();
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "approve test run",
    whenBusy: "queue",
  });
  await expect.poll(() => f.store.agent(target.id).pending.length).toBe(1);
  const pending = f.store.agent(target.id).pending[0]!;
  let returned = false;
  const waiting = f
    .control({ kind: "wait", sessionIds: [target.id], timeoutMs: 2000, on: "change" })
    .then((result) => {
      returned = true;
      return result;
    });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(returned).toBe(false);
  expect(f.store.agent(target.id).pending).toHaveLength(1);
  await f.request({
    kind: "respond",
    sessionId: target.id,
    pendingId: pending.id,
    decision: "accept",
  });
  expect(await waiting).toMatchObject({
    timedOut: false,
    sessions: [{ sessionId: target.id, pending: [] }],
  });
});

it("summarizes file approvals without copying generated source into the Supervisor chat", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold game UI" });
  // Inject the approval into the started turn, not the placeholder its start replaces.
  await expect.poll(() => f.store.agent(target.id).turnId?.startsWith("pending:")).toBe(false);
  const info = f.store.agent(target.id);
  const pending = {
    id: randomUUID(),
    turnId: info.turnId!,
    kind: "approval" as const,
    title: "Allow command execution?",
    summary: '{"file_path":"/tmp/style.css","content":"' + "body".repeat(1200),
    detail: JSON.stringify({
      reason: "Write",
      command:
        JSON.stringify({ file_path: "/tmp/style.css", content: "generated source".repeat(500) }) +
        "\nWrite",
    }),
    decisions: ["accept" as const],
    questions: [],
  };
  f.store.saveAgent({ ...info, status: "needs_input", pending: [pending] });
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  const notice = f.store
    .agentConversation(f.source.id)
    .items.find((i) => i.title === "Agent needs your input");
  expect(notice?.text).toContain("Write style.css");
  expect(notice?.text).not.toContain("generated source");
  expect(notice?.text.length).toBeLessThan(600);
});

it("lets the user stop watching a chat after its workspace was removed", async () => {
  const f = await setup(),
    target = await f.target();
  await f.control({ kind: "watch", sessionId: target.id, enabled: true });
  const project = f.store.snapshot().projects[0]!;
  expect(
    f.store.execute({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: f.store.snapshot().epoch,
      operation: {
        kind: "project.remove",
        projectId: project.id,
        expectedVersion: project.version,
      },
    }).result.outcome.status,
  ).toBe("accepted");
  expect(await f.control({ kind: "status" })).toMatchObject({ watching: [] });
  expect(await f.control({ kind: "watch", sessionId: target.id, enabled: false })).toMatchObject({
    watching: false,
  });
});

it("keeps the daemon running when a waited-on chat's workspace is removed mid-wait", async () => {
  const f = await setup(),
    target = await f.target();
  await f.request({ kind: "send", sessionId: target.id, text: "hold long work" });
  await expect.poll(() => f.store.agent(target.id).status).toBe("working");
  const waiting = f.control({
    kind: "wait",
    sessionIds: [target.id],
    timeoutMs: 5000,
    on: "change",
  });
  const project = f.store.snapshot().projects[0]!;
  f.store.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: f.store.snapshot().epoch,
    operation: { kind: "project.remove", projectId: project.id, expectedVersion: project.version },
  });
  // The worker's next lifecycle event wakes the wait; it used to throw out of the event dispatch.
  f.providers.at(-1)!.finish();
  expect(await waiting).toMatchObject({
    timedOut: false,
    sessions: [{ sessionId: target.id, status: "unavailable" }],
  });
});

it("clears the approval notice when the user answers and the worker resumes", async () => {
  const f = await setup(),
    target = await f.target();
  await f.control({
    kind: "send",
    sessionId: target.id,
    text: "approve the game tests",
    whenBusy: "queue",
  });
  await expect.poll(() => f.store.agent(target.id).pending.length).toBe(1);
  const pending = f.store.agent(target.id).pending[0]!;
  await expect
    .poll(() =>
      f.store
        .agentConversation(f.source.id)
        .items.some((i) => i.text.includes("needs your approval")),
    )
    .toBe(true);
  await f.request({
    kind: "respond",
    sessionId: target.id,
    pendingId: pending.id,
    decision: "accept",
  });
  await expect
    .poll(() =>
      f.store
        .agentConversation(f.source.id)
        .items.some(
          (i) => i.title === "Input no longer pending" && i.text.includes("no longer waiting"),
        ),
    )
    .toBe(true);
  expect(
    f.store
      .agentConversation(f.source.id)
      .items.filter((i) => i.title === "Agent needs your input"),
  ).toHaveLength(0);
});
