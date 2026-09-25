import { DatabaseSync } from "node:sqlite";
import { TestAccountBackend } from "./testing/account.ts";
import { WorkspaceStore } from "../workspace/store.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import {
  builtinAgentProviders,
  type AgentOperation,
  type AgentProviderId,
  type AgentSettings,
} from "@concors/protocol";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "./testing/provider.ts";
let directory = "";
let server: DaemonServer | undefined;
let client: DaemonConnection | undefined;
const instances: {
  provider: AgentProviderId;
  runtime: TestAgentProvider;
  env: NodeJS.ProcessEnv | undefined;
}[] = [];
afterEach(async () => {
  client?.disconnect();
  await server?.close();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  instances.length = 0;
  vi.restoreAllMocks();
});
async function setup() {
  directory = await mkdtemp(join(tmpdir(), "concors-providers-test-"));
  for (const id of builtinAgentProviders)
    await writeFile(join(directory, id + (process.platform === "win32" ? ".cmd" : "")), "", {
      mode: 0o755,
    });
  vi.stubEnv("PATH", directory + delimiter + (process.env["PATH"] ?? ""));
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
    workspacePath: join(directory, "state.db"),
    accountBackendFactory: (info) => new TestAccountBackend(info),
    agentProviderFactory: (_cwd, onInput, provider = "codex", tools) => {
      const runtime = new TestAgentProvider(onInput, provider);
      instances.push({ provider, runtime, env: tools?.env });
      return runtime;
    },
  });
  const c = new DaemonConnection({
    endpoint: describeDaemonEndpoint(await server.listen()),
    client: { kind: "test", name: "providers", version: "0.0.0" },
  });
  client = c;
  c.subscribeWorkspace(() => undefined);
  await c.connect();
  await expect.poll(() => c.workspace).not.toBeNull();
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  for (const operation of [
    { kind: "project.add" as const, projectId, name: "Providers", directory },
    {
      kind: "tab.create" as const,
      projectId,
      expectedVersion: 0,
      tabId,
      paneId,
      name: "Codex",
      profile: "chat" as const,
    },
  ]) {
    const result = await c.executeWorkspace({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: c.workspace!.epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  }
  const result = await c.requestAgent(
    { kind: "start", epoch: c.workspace!.epoch, projectId, tabId, paneId, expectedVersion: 1 },
    randomUUID(),
  );
  expect(result.outcome.status).toBe("ok");
  await expect.poll(() => c.agents[0]?.status).toBe("idle");
  return { c, id: c.agents[0]!.id, projectId, tabId, paneId };
}
it("reuses discovered catalogs across chats, deduplicates loads, and refreshes after expiry", async () => {
  const { c, id } = await setup();
  const load = (provider?: string) =>
    c.requestAgent(
      { kind: "provider-catalog", sessionId: id, ...(provider ? { provider } : {}) },
      randomUUID(),
    );
  const before = TestAgentProvider.turns;
  const [first, second] = await Promise.all([load("claude"), load("claude")]);
  expect(first.outcome.status).toBe("ok");
  expect(second.outcome.status).toBe("ok");
  expect(instances.filter((i) => i.provider === "claude")).toHaveLength(1);
  const list = await load();
  if (list.outcome.status !== "ok") throw new Error("Catalog failed");
  expect(list.outcome.providers?.find((p) => p.id === "claude")).toMatchObject({
    loaded: true,
    models: [{ id: "fixture-claude" }],
  });
  await load("claude");
  expect(instances.filter((i) => i.provider === "claude")).toHaveLength(1);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  await load("claude");
  expect(instances.filter((i) => i.provider === "claude")).toHaveLength(2);
  expect(TestAgentProvider.turns).toBe(before);
  expect(c.agents).toHaveLength(1);
});
it("refreshes the current provider in place and broadcasts its actual reported model", async () => {
  const { c, id } = await setup();
  const runtime = instances[0]!.runtime;
  const calls = runtime.requests.filter((r) => r.method === "model/list").length;
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  await c.requestAgent(
    { kind: "provider-catalog", sessionId: id, provider: "codex" },
    randomUUID(),
  );
  expect(instances).toHaveLength(1);
  expect(runtime.closed).toBe(false);
  expect(runtime.requests.filter((r) => r.method === "model/list")).toHaveLength(calls + 1);
  runtime.emit("session/model/updated", { model: "reported-model" });
  await expect.poll(() => c.agents[0]?.model).toBe("reported-model");
  runtime.emit("session/model/updated", { threadId: "unrelated-child", model: "child-model" });
  const read = await c.requestAgent({ kind: "read", sessionId: id }, randomUUID());
  expect(read.outcome.status).toBe("ok");
  expect(c.agents[0]?.model).toBe("reported-model");
});
it("refreshes Claude's session-cached models without reinitializing a live approval", async () => {
  const { c, id } = await setup();
  const switched = await c.requestAgent(
    {
      kind: "switch-provider",
      sessionId: id,
      provider: "claude",
      model: "fixture-claude",
      expectedRevision: c.agents[0]!.revision,
    },
    randomUUID(),
  );
  if (switched.outcome.status !== "ok") throw new Error("Switch failed");
  const next = switched.outcome.conversation.agent.id;
  await expect.poll(() => c.agents.find((a) => a.id === next)?.status).toBe("idle");
  const live = instances.findLast((i) => i.provider === "claude" && !i.runtime.closed)!.runtime;
  await c.requestAgent({ kind: "send", sessionId: next, text: "approve read" }, randomUUID());
  await expect.poll(() => c.agents.find((a) => a.id === next)?.status).toBe("needs_input");
  const pending = c.agents.find((a) => a.id === next)!.pending;
  const turns = TestAgentProvider.turns;
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  const refreshed = await c.requestAgent(
    { kind: "provider-catalog", sessionId: next, provider: "claude" },
    randomUUID(),
  );
  expect(refreshed.outcome.status).toBe("ok");
  expect(live.closed).toBe(false);
  expect(c.agents.find((a) => a.id === next)).toMatchObject({ status: "needs_input", pending });
  expect(instances.at(-1)?.runtime).not.toBe(live);
  expect(instances.at(-1)?.runtime.closed).toBe(true);
  expect(TestAgentProvider.turns).toBe(turns);
});
it("keeps the last catalog on a failed refresh and retries after a short backoff", async () => {
  const { c, id } = await setup();
  const runtime = instances[0]!.runtime;
  const original = runtime.request.bind(runtime);
  vi.spyOn(runtime, "request").mockImplementationOnce(async () => {
    throw new Error("Temporarily offline");
  });
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  const load = () =>
    c.requestAgent({ kind: "provider-catalog", sessionId: id, provider: "codex" }, randomUUID());
  const failed = await load();
  if (failed.outcome.status !== "ok") throw new Error("Catalog failed");
  expect(failed.outcome.providers?.find((p) => p.id === "codex")).toMatchObject({
    error: "Temporarily offline",
    models: [{ id: "fixture" }],
  });
  vi.mocked(runtime.request).mockImplementation(original);
  clock.mockReturnValue(now + 67000);
  const retried = await load();
  if (retried.outcome.status !== "ok") throw new Error("Retry failed");
  expect(retried.outcome.providers?.find((p) => p.id === "codex")?.error).toBeUndefined();
});
it.each(["claude", "opencode"] as const)(
  "switches to %s in the same pane and restores provider histories without replay",
  async (provider) => {
    const { c, id } = await setup();
    await c.requestAgent(
      { kind: "send", sessionId: id, text: "existing conversation" },
      randomUUID(),
    );
    await expect.poll(() => c.agents.find((a) => a.id === id)?.status).toBe("done");
    const before = TestAgentProvider.turns;
    const catalog = await c.requestAgent({ kind: "provider-catalog", sessionId: id }, randomUUID());
    expect(catalog.outcome.status).toBe("ok");
    if (catalog.outcome.status !== "ok") throw new Error("Catalog failed");
    // Only the three agents a machine is set up with are offered until others are enabled.
    expect(catalog.outcome.providers?.map((p) => p.id)).toEqual(["codex", "claude", "opencode"]);
    expect(instances).toHaveLength(1);
    expect(catalog.outcome.providers?.find((p) => p.id === provider)?.loaded).toBe(false);
    expect(c.agents).toHaveLength(1);
    expect(TestAgentProvider.turns).toBe(before);
    const operation: AgentOperation = {
      kind: "switch-provider",
      sessionId: id,
      provider,
      model: `fixture-${provider}`,
      expectedRevision: c.agents.find((a) => a.id === id)!.revision,
    };
    const requestId = randomUUID();
    const result = await c.requestAgent(operation, requestId);
    expect(result.outcome.status).toBe("ok");
    if (result.outcome.status !== "ok") throw new Error("Switch failed");
    const next = result.outcome.conversation.agent.id;
    await expect.poll(() => c.agents.find((a) => a.id === next)?.status).toBe("idle");
    expect(c.agents.find((a) => a.id === next)?.provider).toBe(provider);
    expect(c.workspace?.projects[0]?.tabs).toHaveLength(1);
    expect(c.workspace?.projects[0]?.tabs.map((tab) => tab.name)).toEqual(["Codex"]);
    expect(c.workspace?.projects[0]?.tabs[0]?.nodes[0]).toMatchObject({ sessionId: next });
    expect(c.workspace?.projects[0]?.tabs[0]?.nodes[0]?.kind).toBe("pane");
    expect((await c.requestAgent(operation, requestId)).outcome.status).toBe("ok");
    expect(c.agents).toHaveLength(2);
    expect(TestAgentProvider.turns).toBe(before);
    expect(
      (
        await c.requestAgent(
          { kind: "send", sessionId: id, text: "Late message from another client" },
          randomUUID(),
        )
      ).outcome,
    ).toMatchObject({ status: "error", message: expect.stringContaining("Switch back") });
    expect(TestAgentProvider.turns).toBe(before);
    const prior = await c.requestAgent({ kind: "read", sessionId: id }, randomUUID());
    expect(prior.outcome.status).toBe("ok");
    if (prior.outcome.status === "ok")
      expect(prior.outcome.conversation.items.some((i) => i.text === "existing conversation")).toBe(
        true,
      );
    expect(instances.filter((i) => i.provider === provider).some((i) => i.runtime.closed)).toBe(
      true,
    );
    await c.requestAgent({ kind: "send", sessionId: next, text: "approve read" }, randomUUID());
    await expect.poll(() => c.agents.find((a) => a.id === next)?.status).toBe("needs_input");
    const pending = c.agents.find((a) => a.id === next)!.pending[0]!;
    await c.requestAgent(
      { kind: "respond", sessionId: next, pendingId: pending.id, decision: "decline" },
      randomUUID(),
    );
    await expect.poll(() => c.agents.find((a) => a.id === next)?.status).toBe("done");
    const revision = c.agents.find((a) => a.id === next)!.revision;
    const invalid = await c.requestAgent(
      {
        kind: "configure",
        sessionId: next,
        expectedRevision: revision,
        settings: { model: null, effort: null, mode: "full-access" },
      },
      randomUUID(),
    );
    expect(invalid.outcome.status).toBe("error");
    const turns = TestAgentProvider.turns;
    const restored = await c.requestAgent(
      {
        kind: "switch-provider",
        sessionId: next,
        provider: "codex",
        model: "fixture",
        expectedRevision: c.agents.find((a) => a.id === next)!.revision,
      },
      randomUUID(),
    );
    expect(restored.outcome.status).toBe("ok");
    if (restored.outcome.status !== "ok") throw new Error("Restore failed");
    expect(restored.outcome.conversation.agent.id).toBe(id);
    expect(
      restored.outcome.conversation.items.some((item) => item.text === "existing conversation"),
    ).toBe(true);
    const again = await c.requestAgent(
      {
        kind: "switch-provider",
        sessionId: id,
        provider,
        model: `fixture-${provider}`,
        expectedRevision: c.agents.find((a) => a.id === id)!.revision,
      },
      randomUUID(),
    );
    expect(again.outcome.status).toBe("ok");
    if (again.outcome.status !== "ok") throw new Error("Second restore failed");
    expect(again.outcome.conversation.agent.id).toBe(next);
    expect(again.outcome.conversation.items.some((item) => item.text === "approve read")).toBe(
      true,
    );
    expect(c.workspace?.projects[0]?.tabs).toHaveLength(1);
    expect(c.agents).toHaveLength(2);
    expect(TestAgentProvider.turns).toBe(turns);
  },
);
it("rejects stale provider switches and unavailable models without adding tabs", async () => {
  const { c, id } = await setup();
  const original = c.agents[0]!;
  for (const change of [
    { expectedRevision: original.revision + 100, model: "fixture-claude" },
    { expectedRevision: original.revision, model: "invented-model" },
  ])
    expect(
      (
        await c.requestAgent(
          { kind: "switch-provider", sessionId: id, provider: "claude", ...change },
          randomUUID(),
        )
      ).outcome.status,
    ).toBe("error");
  expect(c.agents).toHaveLength(1);
  expect(c.workspace?.projects[0]?.tabs).toHaveLength(1);
});

it("serializes competing switches across clients and preserves a split layout", async () => {
  const { c, id, projectId, tabId, paneId } = await setup();
  await c.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: c.workspace!.epoch,
    operation: {
      kind: "pane.split",
      projectId,
      tabId,
      paneId,
      expectedVersion: c.workspace!.projects[0]!.version,
      newPaneId: randomUUID(),
      splitId: randomUUID(),
      axis: "horizontal",
      profile: "shell",
    },
  });
  const before = c.workspace!.projects[0]!.tabs[0]!;
  const other = new DaemonConnection({
    endpoint: c.endpoint,
    client: { kind: "test", name: "competing-switch", version: "0.0.0" },
  });
  const unsubscribe = other.subscribeWorkspace(() => undefined);
  try {
    await other.connect();
    await expect.poll(() => other.workspace).toBeTruthy();
    const revision = c.agents.find((agent) => agent.id === id)!.revision;
    const results = await Promise.all(
      [c, other].map((connection, index) =>
        connection.requestAgent(
          {
            kind: "switch-provider",
            sessionId: id,
            provider: index ? "pi" : "claude",
            model: index ? "fixture-pi" : "fixture-claude",
            expectedRevision: revision,
          },
          randomUUID(),
        ),
      ),
    );
    expect(results.map((result) => result.outcome.status).sort()).toEqual(["error", "ok"]);
    expect(c.agents).toHaveLength(2);
    const after = c.workspace!.projects[0]!.tabs[0]!;
    const winner = results.find((result) => result.outcome.status === "ok")!.outcome;
    if (winner.status !== "ok") throw new Error("No switch succeeded");
    expect(after).toEqual({
      ...before,
      nodes: before.nodes.map((node) =>
        node.kind === "pane" && node.id === paneId
          ? {
              ...node,
              sessionId: winner.conversation.agent.id,
            }
          : node,
      ),
    });
    expect(c.workspace!.projects[0]!.tabs).toHaveLength(1);
    await expect.poll(() => other.workspace).toEqual(c.workspace);
  } finally {
    other.disconnect();
    unsubscribe();
  }
});

it("does not detach working agents or create sessions when their pane was closed", async () => {
  const { c, id, projectId, tabId, paneId } = await setup();
  await c.requestAgent({ kind: "send", sessionId: id, text: "hold" }, randomUUID());
  await expect.poll(() => c.agents.find((agent) => agent.id === id)?.status).toBe("working");
  const change = () =>
    c.requestAgent(
      {
        kind: "switch-provider",
        sessionId: id,
        provider: "claude",
        model: "fixture-claude",
        expectedRevision: c.agents.find((agent) => agent.id === id)!.revision,
      },
      randomUUID(),
    );
  const working = await change();
  expect(working.outcome).toMatchObject({
    status: "error",
    message: expect.stringContaining("Finish or stop"),
  });
  expect(c.agents).toHaveLength(1);
  await c.requestAgent(
    { kind: "interrupt", sessionId: id, turnId: c.agents[0]!.turnId! },
    randomUUID(),
  );
  await c.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: c.workspace!.epoch,
    operation: {
      kind: "pane.close",
      projectId,
      tabId,
      paneId,
      expectedVersion: c.workspace!.projects[0]!.version,
    },
  });
  expect((await change()).outcome.status).toBe("error");
  expect(c.agents).toHaveLength(1);
});

it("restores a provider conversation after reopening the persisted workspace", async () => {
  const { c, id, paneId } = await setup();
  await c.requestAgent(
    { kind: "send", sessionId: id, text: "Keep this across restarts" },
    randomUUID(),
  );
  await expect.poll(() => c.agents[0]?.status).toBe("done");
  const switched = await c.requestAgent(
    {
      kind: "switch-provider",
      sessionId: id,
      provider: "claude",
      model: "fixture-claude",
      expectedRevision: c.agents[0]!.revision,
    },
    randomUUID(),
  );
  if (switched.outcome.status !== "ok") throw new Error("Switch failed");
  const next = switched.outcome.conversation.agent.id;
  await expect.poll(() => c.agents.find((agent) => agent.id === next)?.status).toBe("idle");
  c.disconnect();
  await server!.close();
  server = undefined;
  const store = new WorkspaceStore(join(directory, "state.db"));
  try {
    const current = store.agent(next);
    const restored = store.reserveAgent(
      {
        type: "agent.request",
        requestId: randomUUID(),
        operation: {
          kind: "switch-provider",
          sessionId: next,
          provider: "codex",
          model: "fixture",
          expectedRevision: current.revision,
        },
      },
      { ...current, id: randomUUID(), provider: "codex" },
    );
    expect(restored.id).toBe(id);
    expect(
      store.agentConversation(id).items.some((item) => item.text === "Keep this across restarts"),
    ).toBe(true);
    expect(
      store.snapshot().projects[0]!.tabs[0]!.nodes.find((pane) => pane.id === paneId),
    ).toMatchObject({ sessionId: id });
    expect(store.agents()).toHaveLength(2);
  } finally {
    store.close();
  }
});

it("keeps account exchanges out of receipts and broadcasts, scoped to the initiating socket", async () => {
  const { c, id } = await setup();
  const events: string[] = [];
  c.onAgent((event) => events.push(JSON.stringify(event)));
  const another = new DaemonConnection({
    endpoint: c.endpoint,
    client: { kind: "test", name: "another", version: "0.0.0" },
  });
  try {
    another.subscribeWorkspace(() => undefined);
    await another.connect();
    await expect.poll(() => another.workspace).not.toBeNull();
    const flow = await c.requestAgent(
      { kind: "account", sessionId: id, action: { type: "start", methodId: "fixture" } },
      randomUUID(),
    );
    if (flow.outcome.status !== "ok" || !flow.outcome.account?.challenge)
      throw new Error("Expected sign-in challenge");
    const flowId = flow.outcome.account.challenge.flowId;
    const other = await another.requestAgent(
      { kind: "account", sessionId: id, action: { type: "read" } },
      randomUUID(),
    );
    expect(other.outcome.status === "ok" && other.outcome.account?.challenge).toBeUndefined();
    const rejected = await another.requestAgent(
      {
        kind: "account",
        sessionId: id,
        action: { type: "complete", flowId, value: "test-private-credential" },
      },
      randomUUID(),
    );
    expect(rejected.outcome.status).toBe("error");
    const result = await c.requestAgent(
      {
        kind: "account",
        sessionId: id,
        action: { type: "complete", flowId, value: "test-private-credential" },
      },
      randomUUID(),
    );
    expect(result.outcome.status === "ok" && result.outcome.account?.status).toBe("connected");
    const db = new DatabaseSync(join(directory, "state.db"), { readOnly: true });
    try {
      const receipts = JSON.stringify(db.prepare("SELECT request FROM agent_requests").all());
      expect(receipts).not.toContain('"account"');
      expect(receipts).not.toContain("test-private-credential");
    } finally {
      db.close();
    }
    expect(events.join("\n")).not.toContain("test-private-credential");
    expect(events.join("\n")).not.toContain("TEST-CODE");
  } finally {
    another.disconnect();
  }
});
it("connects a subscription's account from settings without an open session", async () => {
  const { c, id } = await setup();
  const provider = (operation: Parameters<typeof c.requestProvider>[0]) =>
    c.requestProvider(operation, randomUUID());
  const save = await provider({
    kind: "save",
    config: {
      id: "claude-work",
      label: "Claude — Work",
      engine: "claude",
      enabled: true,
      command: ["claude"],
      subscription: { nickname: "Work" },
    },
    expectedRevision: 0,
  });
  if (save.outcome.status !== "ok") throw new Error(save.outcome.message);
  expect(save.outcome.providers.find((p) => p.id === "claude-work")?.subscription).toEqual({
    nickname: "Work",
  });
  const read = await provider({ kind: "account", id: "claude-work", action: { type: "read" } });
  if (read.outcome.status !== "ok") throw new Error(read.outcome.message);
  expect(read.outcome.account?.status).toBe("disconnected");
  const start = await provider({
    kind: "account",
    id: "claude-work",
    action: { type: "start", methodId: "fixture" },
  });
  if (start.outcome.status !== "ok" || !start.outcome.account?.challenge)
    throw new Error("Sign-in did not start");
  const complete = await provider({
    kind: "account",
    id: "claude-work",
    action: {
      type: "complete",
      flowId: start.outcome.account.challenge.flowId,
      value: "test-fixture-code",
    },
  });
  expect(complete.outcome.status).toBe("ok");
  const after = await provider({ kind: "account", id: "claude-work", action: { type: "read" } });
  if (after.outcome.status !== "ok") throw new Error(after.outcome.message);
  expect(after.outcome.account?.status).toBe("connected");
  expect(after.outcome.account?.label).toBe("fixture-account@example.test");
  const usage = await provider({ kind: "usage", id: "claude-work" });
  if (usage.outcome.status !== "ok") throw new Error(usage.outcome.message);
  expect(usage.outcome.usage).toMatchObject({
    status: "available",
    planLabel: "Max 20x",
    windows: expect.arrayContaining([
      expect.objectContaining({ id: "five-hour", usedPercent: 42 }),
      expect.objectContaining({ id: "weekly-fable", usedPercent: 91 }),
    ]),
  });
  expect(instances.at(-1)?.runtime.closed).toBe(true);
  const instanceCount = instances.length;
  await provider({ kind: "usage", id: "claude-work" });
  expect(instances).toHaveLength(instanceCount);
  // Activation is a machine-wide choice, and subscriptions never join the per-chat catalog.
  const activated = await provider({
    kind: "activate",
    engine: "claude",
    id: "claude-work",
    expectedRevision: 1,
  });
  if (activated.outcome.status !== "ok") throw new Error(activated.outcome.message);
  expect(activated.outcome.providers.find((p) => p.id === "claude-work")?.active).toBe(true);
  expect(activated.outcome.providers.find((p) => p.id === "claude")?.active).toBe(false);
  const catalog = await c.requestAgent({ kind: "provider-catalog", sessionId: id }, randomUUID());
  if (catalog.outcome.status !== "ok") throw new Error("Catalog failed");
  expect(catalog.outcome.providers?.some((p) => p.id === "claude-work")).toBe(false);
  expect(catalog.outcome.providers?.some((p) => p.id === "claude")).toBe(true);
});
it("finishes a running turn before reloading a newly activated subscription", async () => {
  const { c, id } = await setup();
  const provider = (operation: Parameters<typeof c.requestProvider>[0]) =>
    c.requestProvider(operation, randomUUID());
  const saved = await provider({
    kind: "save",
    config: {
      id: "codex-work",
      label: "Codex — Work",
      engine: "codex",
      enabled: true,
      command: ["codex"],
      subscription: { nickname: "Work" },
    },
    expectedRevision: 0,
  });
  if (saved.outcome.status !== "ok") throw new Error(saved.outcome.message);

  const running = instances[0]!.runtime;
  await c.requestAgent({ kind: "send", sessionId: id, text: "hold" }, randomUUID());
  await expect.poll(() => c.agents[0]?.status).toBe("working");
  const activated = await provider({
    kind: "activate",
    engine: "codex",
    id: "codex-work",
    expectedRevision: saved.outcome.revision,
  });
  if (activated.outcome.status !== "ok") throw new Error(activated.outcome.message);

  expect(running.closed).toBe(false);
  expect(c.agents[0]?.status).toBe("working");
  running.finish();
  await expect.poll(() => c.agents[0]?.status).toBe("done");
  await expect.poll(() => running.closed).toBe(true);

  await c.requestAgent({ kind: "send", sessionId: id, text: "next turn" }, randomUUID());
  await expect.poll(() => instances).toHaveLength(2);
  await expect.poll(() => c.agents[0]?.status).toBe("done");
});
it("resumes a Codex thread from its legacy state home after switching subscriptions", async () => {
  const { c, id } = await setup();
  await expect.poll(() => c.agents[0]?.threadId).toBe("fixture-thread");
  await c.requestAgent({ kind: "send", sessionId: id, text: "before switch" }, randomUUID());
  await expect.poll(() => c.agents[0]?.status).toBe("done");
  const provider = (operation: Parameters<typeof c.requestProvider>[0]) =>
    c.requestProvider(operation, randomUUID());
  const saved = await provider({
    kind: "save",
    config: {
      id: "codex-work",
      label: "Codex — Work",
      engine: "codex",
      enabled: true,
      command: ["codex"],
      subscription: { nickname: "Work" },
    },
    expectedRevision: 0,
  });
  if (saved.outcome.status !== "ok") throw new Error(saved.outcome.message);
  const legacyHome = join(directory, "accounts", "codex", "codex-work");
  const database = new DatabaseSync(join(legacyHome, "state_5.sqlite"));
  database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY)");
  database.prepare("INSERT INTO threads (id) VALUES (?)").run("fixture-thread");
  database.close();

  const activated = await provider({
    kind: "activate",
    engine: "codex",
    id: "codex-work",
    expectedRevision: saved.outcome.revision,
  });
  if (activated.outcome.status !== "ok") throw new Error(activated.outcome.message);
  await c.requestAgent({ kind: "send", sessionId: id, text: "continue" }, randomUUID());
  await expect.poll(() => instances).toHaveLength(2);
  expect(instances.at(-1)?.env?.["CODEX_SQLITE_HOME"]).toBe(legacyHome);
});
it("opens new chats with the provider and settings last chosen on this machine", async () => {
  const { c, id, projectId } = await setup();
  const agent = (sessionId: string) => c.agents.find((a) => a.id === sessionId);
  const configure = async (sessionId: string, settings: AgentSettings) => {
    await expect.poll(() => agent(sessionId)?.status).toBe("idle");
    const result = await c.requestAgent(
      { kind: "configure", sessionId, settings, expectedRevision: agent(sessionId)!.revision },
      randomUUID(),
    );
    expect(result.outcome).toMatchObject({ status: "ok" });
  };
  const newChat = async () => {
    const tabId = randomUUID(),
      paneId = randomUUID();
    const project = () => c.workspace!.projects.find((p) => p.id === projectId)!;
    const created = await c.executeWorkspace({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: c.workspace!.epoch,
      operation: {
        kind: "tab.create",
        projectId,
        expectedVersion: project().version,
        tabId,
        paneId,
        name: "Chat",
        profile: "chat",
      },
    });
    expect(created.outcome.status).toBe("accepted");
    const started = await c.requestAgent(
      {
        kind: "start",
        epoch: c.workspace!.epoch,
        projectId,
        tabId,
        paneId,
        expectedVersion: project().version,
      },
      randomUUID(),
    );
    if (started.outcome.status !== "ok") throw new Error(started.outcome.message);
    const next = started.outcome.conversation.agent.id;
    await expect.poll(() => agent(next)?.status).toBe("idle");
    return agent(next)!;
  };

  const codex = { model: "fixture", effort: "low", mode: "full-access" as const };
  await configure(id, { ...codex, planMode: true });
  const second = await newChat();
  expect(second).toMatchObject({ provider: "codex", settings: codex });
  expect(second.settings?.planMode).toBeUndefined();
  await c.requestAgent({ kind: "send", sessionId: second.id, text: "hold" }, randomUUID());
  const runtime = instances.findLast((i) => i.provider === "codex")!.runtime;
  await expect
    .poll(() => runtime.requests.find((r) => r.method === "turn/start")?.params)
    .toMatchObject({
      model: "fixture",
      effort: "low",
      sandboxPolicy: { type: "dangerFullAccess" },
    });

  const switched = await c.requestAgent(
    {
      kind: "switch-provider",
      sessionId: id,
      provider: "claude",
      model: "fixture-claude",
      expectedRevision: agent(id)!.revision,
    },
    randomUUID(),
  );
  if (switched.outcome.status !== "ok") throw new Error(switched.outcome.message);
  const claude = switched.outcome.conversation.agent.id;
  await configure(claude, { model: "fixture-claude", effort: "high", mode: "default" });
  const third = await newChat();
  expect(third).toMatchObject({
    provider: "claude",
    settings: { model: "fixture-claude", effort: "high", mode: "default" },
  });

  c.disconnect();
  await server!.close();
  server = undefined;
  const store = new WorkspaceStore(join(directory, "state.db"));
  try {
    expect(store.agentDefaultProviders()).toEqual(["claude", "codex"]);
    expect(store.agentDefaults("codex")).toEqual(codex);
  } finally {
    store.close();
  }
});
it("stops a closed chat's CLI once its turn settles and resumes the thread when reopened", async () => {
  const { c, id, projectId, tabId } = await setup();
  const runtime = instances[0]!.runtime;
  await c.requestAgent({ kind: "send", sessionId: id, text: "hold" }, randomUUID());
  await expect.poll(() => c.agents.find((a) => a.id === id)?.status).toBe("working");
  const closed = await c.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: c.workspace!.epoch,
    operation: {
      kind: "tab.close",
      projectId,
      tabId,
      expectedVersion: c.workspace!.projects.find((p) => p.id === projectId)!.version,
    },
  });
  expect(closed.outcome.status).toBe("accepted");
  // A running turn is never cut short by closing its tab.
  expect(runtime.closed).toBe(false);
  runtime.finish();
  await expect.poll(() => runtime.closed).toBe(true);
  await expect.poll(() => c.agents.find((a) => a.id === id)?.status).toBe("done");
  const threadId = c.agents.find((a) => a.id === id)!.threadId;

  const open = await c.requestAgent({ kind: "open-session", sessionId: id }, randomUUID());
  expect(open.outcome.status).toBe("ok");
  await c.requestAgent({ kind: "send", sessionId: id, text: "hello again" }, randomUUID());
  await expect.poll(() => instances.length).toBe(2);
  const resumed = instances[1]!.runtime;
  expect(resumed.requests.find((r) => r.method === "thread/resume")?.params).toMatchObject({
    threadId,
  });
  await expect.poll(() => c.agents.find((a) => a.id === id)?.status).toBe("done");
  expect(resumed.closed).toBe(false);
});
it("stops an idle chat's CLI as soon as its pane closes", async () => {
  const { c, id, projectId, tabId } = await setup();
  const runtime = instances[0]!.runtime;
  const closed = await c.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: c.workspace!.epoch,
    operation: {
      kind: "tab.close",
      projectId,
      tabId,
      expectedVersion: c.workspace!.projects.find((p) => p.id === projectId)!.version,
    },
  });
  expect(closed.outcome.status).toBe("accepted");
  expect(runtime.closed).toBe(true);
  expect(c.agents.find((a) => a.id === id)?.status).toBe("idle");
});
