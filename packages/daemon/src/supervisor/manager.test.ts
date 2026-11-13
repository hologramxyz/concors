import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentOperation, SupervisorControl } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { AgentManager } from "../agents/manager.ts";
import { ProviderRegistry } from "../agents/providers/registry.ts";
import { TestAgentProvider } from "../agents/testing/provider.ts";
import { SupervisorManager } from "./manager.ts";
import { SupervisorTools } from "./tools.ts";

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
    control: (operation: SupervisorControl["operation"], requestId = randomUUID()) =>
      manager!.control(source.id, { requestId, operation }),
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
  await Promise.all([f.control(operation, requestId), f.control(operation, requestId)]);
  await expect.poll(() => f.manager.deliveries()[0]?.status).toBe("done");
  await f.control(operation, requestId);
  expect(
    f.providers.flatMap((p) => p.requests).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
  expect(f.store.supervisorPrompt(target.id, requestId)?.origin).toEqual({
    supervisorId: f.source.id,
    deliveryId: requestId,
  });
  expect(
    f.store
      .agentConversation(f.source.id)
      .items.filter((i) => i.id === `supervisor:${requestId}:done`),
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
  f.store.saveSupervisorRecord("request:" + requestId, {
    sessionId: f.source.id,
    request: { requestId, operation },
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
