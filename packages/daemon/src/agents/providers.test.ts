import { DatabaseSync } from "node:sqlite";
import { TestAccountBackend } from "./testing/account.ts";
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
} from "@concors/protocol";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "./testing/provider.ts";
let directory = "";
let server: DaemonServer | undefined;
let client: DaemonConnection | undefined;
const instances: { provider: AgentProviderId; runtime: TestAgentProvider }[] = [];
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
    agentProviderFactory: (_cwd, onInput, provider = "codex") => {
      const runtime = new TestAgentProvider(onInput, provider);
      instances.push({ provider, runtime });
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
  return { c, id: c.agents[0]!.id };
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
it.each(["claude", "opencode", "pi"] as const)(
  "starts %s without replacing or replaying the current conversation",
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
    expect(catalog.outcome.providers?.map((p) => p.id)).toEqual([
      "codex",
      "claude",
      "opencode",
      "pi",
      "copilot",
    ]);
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
    expect(c.workspace?.projects[0]?.tabs).toHaveLength(2);
    expect(c.workspace?.projects[0]?.tabs.map((tab) => tab.name)).toEqual(["Codex", "Tab 2"]);
    expect(c.workspace?.projects[0]?.tabs[0]?.nodes[0]?.kind).toBe("pane");
    expect((await c.requestAgent(operation, requestId)).outcome.status).toBe("ok");
    expect(c.agents).toHaveLength(2);
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
