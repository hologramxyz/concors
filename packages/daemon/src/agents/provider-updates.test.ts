import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../workspace/store.ts";
import { AgentManager } from "./manager.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { TestAgentProvider } from "./testing/provider.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "concors-provider-updates-"));
  const workspace = new WorkspaceStore(join(directory, "workspace.sqlite"));
  const registry = new ProviderRegistry(join(directory, "providers"));
  vi.spyOn(registry, "installed").mockReturnValue(true);
  const providers: TestAgentProvider[] = [];
  const agents = new AgentManager(
    workspace,
    () => {
      /* No connected clients in this test. */
    },
    () => {
      /* No connected clients in this test. */
    },
    (cwd, handler, id) => {
      const provider = new TestAgentProvider(handler, id);
      provider.cwd = cwd;
      providers.push(provider);
      return provider;
    },
    registry,
  );
  const projectId = randomUUID();
  workspace.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: workspace.snapshot().epoch,
    operation: { kind: "project.add", projectId, name: "App", directory },
  });
  cleanups.push(async () => {
    await agents.close();
    registry.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { agents, registry, providers, projectId };
}

it("starts no CLI while its update is rewriting the package", async () => {
  const f = await setup();
  let finish: () => void = () => undefined;
  let update: Promise<void> | undefined = new Promise<void>((resolve) => (finish = resolve));
  // As in the registry, a finished update is gone before anything waiting on it resumes.
  void update.then(() => (update = undefined));
  vi.spyOn(f.registry, "pendingUpdate").mockImplementation((config) =>
    config.id === "codex" ? update : undefined,
  );
  const codex = f.agents.startScheduled(randomUUID(), f.projectId, "codex", "fixture");
  await f.agents.startScheduled(randomUUID(), f.projectId, "claude", "fixture-claude");
  expect(f.providers.map((p) => p.provider)).toEqual(["claude"]);

  finish();
  await codex;
  expect(f.providers.map((p) => p.provider)).toEqual(["claude", "codex"]);
});

it("counts a provider as in use only while one of its chats is mid-turn", async () => {
  const f = await setup();
  const info = await f.agents.startScheduled(randomUUID(), f.projectId, "claude", "fixture-claude");
  expect(f.agents.usingProvider("claude")).toBe(false);
  await f.agents.request({
    type: "agent.request",
    requestId: randomUUID(),
    operation: { kind: "send", sessionId: info.id, text: "hold" },
  });
  expect(f.agents.usingProvider("claude")).toBe(true);
  expect(f.agents.usingProvider("codex")).toBe(false);
});
