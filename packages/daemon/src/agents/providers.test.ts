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
