import { randomUUID } from "node:crypto";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceCommand, WorkspaceSnapshot } from "@concors/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { loadDaemonConfig } from "../config.ts";
import { createDaemonServer, type DaemonServer } from "../server.ts";

const connections: DaemonConnection[] = [];
let server: DaemonServer | undefined;
afterEach(async () => {
  for (const c of connections.splice(0)) c.disconnect();
  await server?.close();
});

async function open(url: string) {
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "sync", version: "0.0.0" },
  });
  connections.push(connection);
  const snapshots: WorkspaceSnapshot[] = [];
  connection.subscribeWorkspace((snapshot) => snapshots.push(snapshot));
  await connection.connect();
  await expect.poll(() => connection.workspace).not.toBeNull();
  return { connection, snapshots };
}

describe("workspace synchronization over real WebSockets", () => {
  it("converges two clients, rejects stale edits, retries once and resynchronizes on reconnect", async () => {
    server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
    const url = await server.listen();
    const first = await open(url),
      second = await open(url);
    const projectId = randomUUID(),
      tabId = randomUUID(),
      paneId = randomUUID();
    const command: WorkspaceCommand = {
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: first.connection.workspace!.epoch,
      operation: { kind: "project.add", projectId, name: "Concors", directory: "/concors" },
    };
    const accepted = await first.connection.executeWorkspace(command);
    expect(accepted.outcome.status).toBe("accepted");
    await expect.poll(() => second.connection.workspace?.revision).toBe(1);
    expect(await first.connection.executeWorkspace(command)).toEqual(accepted);
    expect(first.connection.workspace!.projects).toHaveLength(1);
    await first.connection.executeWorkspace({
      ...command,
      commandId: randomUUID(),
      operation: {
        kind: "tab.create",
        projectId,
        expectedVersion: 0,
        tabId,
        paneId,
        name: "Build",
        profile: "shell",
      },
    });
    const stale = await second.connection.executeWorkspace({
      ...command,
      commandId: randomUUID(),
      operation: { kind: "project.remove", projectId, expectedVersion: 0 },
    });
    expect(stale.outcome).toMatchObject({ status: "rejected", code: "CONFLICT" });
    expect(second.connection.workspace).toEqual(first.connection.workspace);
    second.connection.disconnect();
    await first.connection.executeWorkspace({
      ...command,
      commandId: randomUUID(),
      operation: {
        kind: "pane.split",
        projectId,
        tabId,
        paneId,
        expectedVersion: 1,
        splitId: randomUUID(),
        newPaneId: randomUUID(),
        axis: "vertical",
        profile: "chat",
      },
    });
    await second.connection.connect();
    await expect.poll(() => second.connection.workspace?.revision).toBe(3);
    expect(second.connection.workspace).toEqual(first.connection.workspace);
    expect(second.connection.workspace!.projects[0]!.tabs[0]!.nodes).toHaveLength(3);
  });

  it("requires the handshake before allowing workspace mutation", async () => {
    server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
    const url = await server.listen();
    const result = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ type: "workspace.subscribe" })),
      );
      socket.addEventListener("message", (event) => resolve(String(event.data)));
      socket.addEventListener("error", reject);
    });
    expect(JSON.parse(result)).toMatchObject({
      type: "error",
      error: { code: "HANDSHAKE_REQUIRED" },
    });
  });
});
