import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { MAX_LIVE_SUB_AGENTS, type AgentItem } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { AgentManager } from "./manager.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { TestAgentProvider } from "./testing/provider.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "concors-live-sub-agents-"));
  const workspace = new WorkspaceStore(join(directory, "state.db"));
  const registry = new ProviderRegistry(join(directory, "providers"));
  const projectId = randomUUID();
  workspace.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: workspace.snapshot().epoch,
    operation: { kind: "project.add", projectId, name: "App", directory },
  });
  const manager = new AgentManager(
    workspace,
    () => undefined,
    () => undefined,
    (cwd, handler, id) => {
      const provider = new TestAgentProvider(handler, id);
      provider.cwd = cwd;
      return provider;
    },
    registry,
  );
  const info = await manager.startScheduled(randomUUID(), projectId, "codex", "fixture");
  await manager.close();
  cleanups.push(async () => {
    registry.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { workspace, id: info.id };
}

function row(sessionId: string, id: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id,
    sessionId,
    position: 0,
    revision: 0,
    turnId: "turn",
    kind: "tool",
    title: "Sub-agents",
    text: id,
    detail: "",
    status: "running",
    createdAt: new Date().toISOString(),
    presentation: { type: "sub_agent", background: true },
    ...overrides,
  };
}

it("reports a running sub-agent that has left the latest page of its chat", async () => {
  const { workspace, id } = await setup();
  workspace.saveAgentItem(row(id, "still-working"));
  workspace.saveAgentItem(row(id, "finished", { status: "completed" }));
  for (let index = 0; index < 100; index++)
    workspace.saveAgentItem(
      row(id, `filler-${index}`, { kind: "assistant", presentation: undefined }),
    );

  const page = workspace.agentConversation(id);
  expect(page.items.some((item) => item.id === "still-working")).toBe(false);
  expect(page.liveSubAgents?.map((item) => item.id)).toEqual(["still-working"]);
  expect(page.liveSubAgents?.[0]?.position).toBeGreaterThan(0);
});

it("keeps the newest running sub-agents when a chat has more than one read reports", async () => {
  const { workspace, id } = await setup();
  for (let index = 0; index < MAX_LIVE_SUB_AGENTS + 3; index++)
    workspace.saveAgentItem(row(id, `agent-${index}`));

  const live = workspace.agentConversation(id).liveSubAgents ?? [];
  expect(live).toHaveLength(MAX_LIVE_SUB_AGENTS);
  expect(live.at(-1)?.id).toBe(`agent-${MAX_LIVE_SUB_AGENTS + 2}`);
  expect(live[0]?.id).toBe("agent-3");
});
