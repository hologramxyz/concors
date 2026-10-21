import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../workspace/store.ts";
import { parseMemoryKills } from "../host/memory-kills.ts";
import { AgentManager } from "./manager.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { TestAgentProvider } from "./testing/provider.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

function manager(workspace: WorkspaceStore, registry: ProviderRegistry) {
  return new AgentManager(
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
}

/** A chat that finished its turn while sub-agents it sent to the background kept working. */
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "concors-restart-notice-"));
  const workspace = new WorkspaceStore(join(directory, "workspace.sqlite"));
  const registry = new ProviderRegistry(join(directory, "providers"));
  vi.spyOn(registry, "installed").mockReturnValue(true);
  const projectId = randomUUID();
  workspace.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: workspace.snapshot().epoch,
    operation: { kind: "project.add", projectId, name: "App", directory },
  });
  const first = manager(workspace, registry);
  const info = await first.startScheduled(randomUUID(), projectId, "codex", "fixture");
  await first.close();
  workspace.saveAgent({ ...workspace.agent(info.id), status: "done", backgroundAgents: 2 });
  cleanups.push(async () => {
    registry.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, workspace, registry, id: info.id };
}

it("tells a done chat whose background sub-agents a restart ended that they are gone", async () => {
  const f = await setup();
  const restarted = manager(f.workspace, f.registry);
  cleanups.push(() => restarted.close());
  expect(f.workspace.agent(f.id)).toMatchObject({
    status: "interrupted",
    backgroundAgents: 0,
    error: expect.stringContaining("The daemon restarted"),
  });
});

it.skipIf(process.platform !== "linux")(
  "says the machine ran out of memory when the kernel killed a process since the last record",
  async () => {
    const f = await setup();
    const now = parseMemoryKills(
      readFileSync("/proc/vmstat", "utf8"),
      readFileSync("/proc/sys/kernel/random/boot_id", "utf8"),
    );
    if (!now) return;
    // As recorded a minute before memory ran out: one kill fewer, in this boot.
    writeFileSync(
      join(f.directory, "memory-kills.json"),
      JSON.stringify({ ...now, kills: now.kills - 1 }),
    );
    const restarted = manager(f.workspace, f.registry);
    cleanups.push(() => restarted.close());
    expect(f.workspace.agent(f.id).error).toContain("This machine ran out of memory");
  },
);
