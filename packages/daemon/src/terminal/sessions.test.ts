import { installTestCodexProfile, installTestClaudeProfile } from "./testing/profile.ts";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { TerminalEvent, TerminalOperation, WorkspaceOperation } from "@concors/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { loadDaemonConfig } from "../config.ts";
import { createDaemonServer, type DaemonServer } from "../server.ts";

let server: DaemonServer | undefined;
const connections: DaemonConnection[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0)) connection.disconnect();
  await server?.close();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
async function open(url: string) {
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "terminal", version: "0.0.0" },
  });
  connections.push(connection);
  const events: TerminalEvent[] = [];
  connection.onTerminal((event) => events.push(event));
  connection.subscribeWorkspace(() => undefined);
  await connection.connect();
  await expect.poll(() => connection.workspace).not.toBeNull();
  return { connection, events };
}
async function edit(connection: DaemonConnection, operation: WorkspaceOperation) {
  const result = await connection.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: connection.workspace!.epoch,
    operation,
  });
  expect(result.outcome.status).toBe("accepted");
}
async function request(
  connection: DaemonConnection,
  operation: TerminalOperation,
  id = randomUUID(),
) {
  const result = await connection.requestTerminal(operation, id);
  if (result.outcome.status === "error") throw new Error(result.outcome.message);
  return result.outcome.sessions;
}
it("shares a real PTY, transfers control, replays its screen, rebinds and records interrupted sessions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concors-terminal-"));
  directories.push(directory);
  const options = { workspacePath: join(directory, "workspace.sqlite") };
  const config = loadDaemonConfig({ port: 0, logLevel: "silent" }, {});
  server = createDaemonServer(config, options);
  const url = await server.listen();
  const first = await open(url),
    second = await open(url);
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  await edit(first.connection, { kind: "project.add", projectId, name: "PTY", directory });
  await edit(first.connection, {
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Shell",
    profile: "shell",
  });
  const start: TerminalOperation = {
    kind: "start",
    epoch: first.connection.workspace!.epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    expectedSessionId: null,
    cols: 80,
    rows: 24,
  };
  const receipt = randomUUID();
  const [session] = await request(first.connection, start, receipt);
  expect(session?.status, session?.error ?? "PTY launch").toBe("running");
  const sessionId = session!.id;
  expect((await request(second.connection, start, receipt))[0]?.id).toBe(sessionId);
  expect(await request(first.connection, { kind: "list" })).toHaveLength(1);
  await expect
    .poll(() => second.connection.workspace?.projects[0]?.tabs[0]?.nodes[0])
    .toMatchObject({ sessionId });
  await request(first.connection, { kind: "attach", sessionId });
  await request(second.connection, { kind: "attach", sessionId });
  await request(first.connection, { kind: "claim", sessionId, cols: 90, rows: 25 });
  await request(second.connection, {
    kind: "claim",
    sessionId,
    cols: 30,
    rows: 10,
    ifUnowned: true,
  });
  await expect(
    request(second.connection, { kind: "resize", sessionId, cols: 30, rows: 10 }),
  ).rejects.toThrow("take control");
  first.connection.sendTerminalInput(sessionId, "echo concors-pty-alive\r");
  await expect
    .poll(() =>
      second.events
        .filter((e) => e.type === "terminal.output")
        .map((e) => e.data)
        .join(""),
    )
    .toContain("concors-pty-alive");
  await request(second.connection, { kind: "claim", sessionId, cols: 80, rows: 24 });
  first.connection.sendTerminalInput(sessionId, "echo forbidden\r");
  await expect
    .poll(() =>
      first.events.some((e) => e.type === "terminal.error" && e.message.includes("Take control")),
    )
    .toBe(true);
  second.connection.disconnect();
  await second.connection.connect();
  await expect.poll(() => second.connection.workspace).not.toBeNull();
  second.events.length = 0;
  await request(second.connection, { kind: "attach", sessionId });
  expect(second.events.find((e) => e.type === "terminal.snapshot")).toMatchObject({
    data: expect.stringContaining("concors-pty-alive"),
    session: { status: "running" },
  });
  // Closing a tab detaches the view, leaving a discoverable process that can be rebound.
  await edit(first.connection, { kind: "tab.close", projectId, tabId, expectedVersion: 2 });
  const newTab = randomUUID(),
    newPane = randomUUID();
  await edit(first.connection, {
    kind: "tab.create",
    projectId,
    tabId: newTab,
    paneId: newPane,
    expectedVersion: 3,
    name: "Reattach",
    profile: "shell",
  });
  await request(first.connection, {
    kind: "bind",
    projectId,
    tabId: newTab,
    paneId: newPane,
    expectedVersion: 4,
    sessionId,
  });
  expect(first.connection.workspace!.projects[0]!.tabs[0]!.nodes[0]).toMatchObject({ sessionId });
  expect((await request(first.connection, { kind: "stop", sessionId }))[0]?.status).toBe("exited");
  const next = await request(first.connection, {
    ...start,
    tabId: newTab,
    paneId: newPane,
    expectedVersion: 5,
    expectedSessionId: sessionId,
  });
  expect(next[0]?.status).toBe("running");
  for (const c of connections) c.disconnect();
  await server.close();
  server = createDaemonServer(config, options);
  const restartUrl = await server.listen();
  const after = await open(restartUrl);
  const sessions = await request(after.connection, { kind: "list" });
  expect(sessions.find((s) => s.id === next[0]!.id)?.status).toBe("interrupted");
  expect((await request(after.connection, start, receipt))[0]?.id).toBe(sessionId);
  expect(await request(after.connection, { kind: "list" })).toHaveLength(2);
  const recover: TerminalOperation = {
    ...start,
    recover: true,
    tabId: newTab,
    paneId: newPane,
    expectedVersion: 0, // Recovery of this exact binding tolerates unrelated project changes.
    expectedSessionId: next[0]!.id,
  };
  const other = await open(restartUrl);
  const [recovered, duplicate] = await Promise.all([
    request(after.connection, recover),
    request(other.connection, recover),
  ]);
  expect(recovered[0]?.status).toBe("running");
  expect(duplicate[0]?.id).toBe(recovered[0]?.id);
  expect(await request(after.connection, { kind: "list" })).toHaveLength(3);
  await expect(request(after.connection, { ...recover, epoch: randomUUID() })).rejects.toThrow();
}, 15000);

it("rejects network exposure before starting a terminal-enabled daemon", () => {
  expect(() => createDaemonServer(loadDaemonConfig({ host: "0.0.0.0" }, {}))).toThrow("loopback");
});

it("broadcasts Codex profile lifecycle to unattached clients and restores it on reconnect", async () => {
  const directory = mkdtempSync(join(tmpdir(), "concors-codex-terminal-"));
  directories.push(directory);
  vi.stubEnv("PATH", installTestCodexProfile(directory) + delimiter + (process.env["PATH"] ?? ""));
  const config = loadDaemonConfig({ port: 0, logLevel: "silent" }, {});
  const options = { workspacePath: join(directory, "workspace.sqlite") };
  server = createDaemonServer(config, options);
  const url = await server.listen();
  const first = await open(url);
  const observer = await open(url);
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  await edit(first.connection, { kind: "project.add", projectId, name: "Codex", directory });
  await edit(first.connection, {
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Codex",
    profile: "codex",
  });
  const start: TerminalOperation = {
    kind: "start",
    epoch: first.connection.workspace!.epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    expectedSessionId: null,
    cols: 80,
    rows: 24,
  };
  const receipt = randomUUID();
  const [session] = await request(first.connection, start, receipt);
  expect(session?.status).toBe("running");
  const id = session!.id;
  await expect
    .poll(() => observer.connection.terminals)
    .toMatchObject([{ id, profile: "codex", status: "running" }]);
  expect(observer.events.some((event) => event.type === "terminal.output")).toBe(false);
  await request(first.connection, start, receipt);
  expect(first.connection.terminals.filter((item) => item.id === id)).toHaveLength(1);
  observer.connection.disconnect();
  await observer.connection.connect();
  await expect.poll(() => observer.connection.terminals).toMatchObject([{ id, status: "running" }]);
  await request(first.connection, { kind: "attach", sessionId: id });
  await request(first.connection, { kind: "claim", sessionId: id, cols: 80, rows: 24 });
  // A spawned PTY can be running before the executable is ready to accept input.
  await expect
    .poll(
      () =>
        first.events
          .filter((event) => event.type === "terminal.output" || event.type === "terminal.snapshot")
          .map((event) => event.data)
          .join(""),
      { timeout: 5000 },
    )
    .toContain("CODEX_TERMINAL_READY");
  first.connection.sendTerminalInput(id, "fail\r");
  await expect
    .poll(() => observer.connection.terminals.find((item) => item.id === id)?.status, {
      timeout: 5000,
    })
    .toBe("failed");
  const [next] = await request(first.connection, {
    ...start,
    expectedVersion: 2,
    expectedSessionId: id,
  });
  expect(next?.status).toBe("running");
  for (const connection of connections) connection.disconnect();
  await server.close();
  server = createDaemonServer(config, options);
  const restarted = await open(await server.listen());
  await expect
    .poll(() => restarted.connection.terminals.find((item) => item.id === next?.id)?.status)
    .toBe("interrupted");
}, 15000);

it.each(["codex", "claude"] as const)(
  "discovers %s inside a shell, broadcasts activity, and clears it on return",
  async (agent) => {
    const directory = mkdtempSync(join(tmpdir(), "concors-shell-agent-"));
    directories.push(directory);
    vi.stubEnv(
      "PATH",
      installTestCodexProfile(directory) + delimiter + (process.env["PATH"] ?? ""),
    );
    installTestClaudeProfile(directory);
    if (process.platform !== "win32") vi.stubEnv("SHELL", "/bin/sh");
    server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
      workspacePath: join(directory, "workspace.sqlite"),
    });
    const url = await server.listen();
    const first = await open(url),
      observer = await open(url);
    const projectId = randomUUID(),
      tabId = randomUUID(),
      paneId = randomUUID();
    await edit(first.connection, { kind: "project.add", projectId, name: "Shell", directory });
    await edit(first.connection, {
      kind: "tab.create",
      projectId,
      tabId,
      paneId,
      expectedVersion: 0,
      name: "Terminal",
      profile: "shell",
    });
    const [session] = await request(first.connection, {
      kind: "start",
      epoch: first.connection.workspace!.epoch,
      projectId,
      tabId,
      paneId,
      expectedVersion: 1,
      expectedSessionId: null,
      cols: 80,
      rows: 24,
    });
    const id = session!.id;
    await request(first.connection, { kind: "attach", sessionId: id });
    await request(first.connection, { kind: "claim", sessionId: id, cols: 80, rows: 24 });
    first.connection.sendTerminalInput(id, `${agent}\r`);
    await expect
      .poll(() => observer.connection.terminals.find((s) => s.id === id), { timeout: 10000 })
      .toMatchObject({ profile: "shell", detectedAgent: agent, status: "running" });
    for (const [command, activity] of [
      ["test-working", "working"],
      ["test-approval", "needs_input"],
      ["test-idle", "idle"],
    ]) {
      first.connection.sendTerminalInput(id, `${command}\r`);
      for (const client of [first, observer])
        await expect
          .poll(() => client.connection.terminals.find((s) => s.id === id)?.agentActivity)
          .toBe(activity);
    }
    observer.connection.disconnect();
    await observer.connection.connect();
    await expect
      .poll(() => observer.connection.terminals.find((s) => s.id === id)?.detectedAgent)
      .toBe(agent);
    await expect
      .poll(() => observer.connection.terminals.find((s) => s.id === id)?.agentActivity)
      .toBe("idle");
    first.connection.sendTerminalInput(id, "exit\r");
    await expect
      .poll(() => observer.connection.terminals.find((s) => s.id === id), { timeout: 10000 })
      .toMatchObject({ detectedAgent: null, status: "running" });
    first.connection.sendTerminalInput(id, `${agent}\r`);
    await expect
      .poll(() => observer.connection.terminals.find((s) => s.id === id)?.detectedAgent, {
        timeout: 10000,
      })
      .toBe(agent);
  },
  30000,
);
