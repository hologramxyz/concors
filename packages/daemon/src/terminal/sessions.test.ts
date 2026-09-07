import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { TerminalEvent, TerminalOperation, WorkspaceOperation } from "@concors/protocol";
import { afterEach, expect, it } from "vitest";
import { loadDaemonConfig } from "../config.ts";
import { createDaemonServer, type DaemonServer } from "../server.ts";

let server: DaemonServer | undefined;
const connections: DaemonConnection[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0)) connection.disconnect();
  await server?.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
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
  const after = await open(await server.listen());
  const sessions = await request(after.connection, { kind: "list" });
  expect(sessions.find((s) => s.id === next[0]!.id)?.status).toBe("interrupted");
  expect((await request(after.connection, start, receipt))[0]?.id).toBe(sessionId);
  expect(await request(after.connection, { kind: "list" })).toHaveLength(2);
}, 15000);

it("rejects network exposure before starting a terminal-enabled daemon", () => {
  expect(() => createDaemonServer(loadDaemonConfig({ host: "0.0.0.0" }, {}))).toThrow("loopback");
});
