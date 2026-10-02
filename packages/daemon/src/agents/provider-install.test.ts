import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { AgentOperation } from "@concors/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "./testing/provider.ts";
import { TestAccountBackend } from "./testing/account.ts";
import { ProviderRegistry } from "./providers/registry.ts";

vi.setConfig({ testTimeout: 15_000 });

let server: DaemonServer | undefined;
let directory = "";
const clients: DaemonConnection[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("a chat that failed for a missing CLI starts once Concors installs it", async () => {
  directory = await mkdtemp(join(tmpdir(), "concors-install-"));
  // No agent CLI anywhere on PATH, like a machine that never installed one.
  await mkdir(join(directory, "empty-path"));
  vi.stubEnv("PATH", join(directory, "empty-path"));
  vi.stubEnv("CONCORS_DATA_DIR", directory);
  const registry = new ProviderRegistry(join(directory, "providers"));
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
    workspacePath: join(directory, "state.db"),
    accountBackendFactory: (info) => new TestAccountBackend(info),
    // The fixture speaks the provider protocol; the launch check is the real one.
    agentProviderFactory: (cwd, handler, id) => {
      registry.launcher(registry.config(id ?? "codex"));
      const provider = new TestAgentProvider(handler, id);
      provider.cwd = cwd;
      return provider;
    },
  });
  const url = await server.listen();
  const client = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "install", version: "0.0.0" },
  });
  clients.push(client);
  client.subscribeWorkspace(() => undefined);
  await client.connect();
  await expect.poll(() => client.workspace).not.toBeNull();
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  for (const operation of [
    { kind: "project.add", projectId, name: "Install", directory },
    {
      kind: "tab.create",
      projectId,
      tabId,
      paneId,
      expectedVersion: 0,
      name: "Chat",
      profile: "chat",
    },
  ] as const)
    await client.executeWorkspace({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: client.workspace!.epoch,
      operation,
    });
  const agent = (op: AgentOperation) => client.requestAgent(op, randomUUID());
  await agent({
    kind: "start",
    epoch: client.workspace!.epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
  });
  await expect.poll(() => client.agents[0]?.status).toBe("failed");
  const id = client.agents[0]!.id;
  expect(client.agents[0]!.error).toBe("Codex is not installed on this machine.");

  const list = async () => {
    const result = await client.requestProvider({ kind: "list" }, randomUUID());
    if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
    return result.outcome.providers.find((p) => p.id === "codex")!;
  };
  for (const engine of ["codex", "claude", "opencode"]) {
    const result = await client.requestProvider({ kind: "list" }, randomUUID());
    if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
    expect(result.outcome.providers.find((p) => p.id === engine)).toMatchObject({
      installed: false,
      canInstall: true,
    });
  }

  // What a finished install leaves behind: the CLI in Concors' own prefix for it.
  const bin = join(directory, "providers", "codex", "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  const executable = join(bin, process.platform === "win32" ? "codex.cmd" : "codex");
  await writeFile(executable, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\n");
  await chmod(executable, 0o755);
  expect(await list()).toMatchObject({ installed: true });

  // The desktop resumes the failed chat, which clears its error; the next message starts it.
  expect((await agent({ kind: "queue-pause", sessionId: id, paused: false })).outcome.status).toBe(
    "ok",
  );
  await expect.poll(() => client.agents[0]?.status).toBe("idle");
  expect(client.agents[0]!.error ?? null).toBeNull();
  expect((await agent({ kind: "send", sessionId: id, text: "hello" })).outcome.status).toBe("ok");
  await expect.poll(() => client.agents[0]?.status).toBe("done");
  expect(client.agents[0]!.error ?? null).toBeNull();
});
