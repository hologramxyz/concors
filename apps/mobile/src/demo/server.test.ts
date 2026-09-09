import { describe, expect, it } from "vitest";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { createDemoServer } from "./server";
import { ids } from "./fixtures";
import { ApiClient } from "@concors/api-client";
describe("mobile demo protocol fixture", () => {
  it("validates machine, billing, organization and SSH fixtures through the real API client", async () => {
    const server = createDemoServer();
    const api = new ApiClient({ baseUrl: "https://demo.invalid", fetch: server.fetch });
    expect(await api.listOrganizations()).toHaveLength(1);
    expect((await api.getMachineCatalog()).sizes[0]?.ramGb).toBe(8);
    expect(await api.listMachines()).toHaveLength(1);
    expect((await api.getBillingStatus()).configured).toBe(false);
    const key = await api.addSshKey({ name: "Phone", publicKey: "ssh-ed25519 AAAAdemo" });
    expect((await api.listSshKeys())[0]?.id).toBe(key.id);
    await api.removeSshKey(key.id);
    expect(await api.listSshKeys()).toEqual([]);
  });
  it("supports real workspace operations, new agents, and idempotent retries", async () => {
    const server = createDemoServer();
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint("wss://demo.invalid/ws"),
      client: { kind: "mobile", name: "demo-test", version: "0.1.0" },
      webSocketFactory: server.socket,
    });
    connection.subscribeWorkspace(() => undefined);
    await connection.connect();
    await Promise.resolve();
    const workspace = connection.workspace!;
    const tabId = crypto.randomUUID(),
      paneId = crypto.randomUUID();
    const command = {
      type: "workspace.command" as const,
      commandId: crypto.randomUUID(),
      epoch: workspace.epoch,
      operation: {
        kind: "tab.create" as const,
        projectId: ids.project,
        expectedVersion: workspace.projects[0]!.version,
        tabId,
        paneId,
        name: "Second",
        profile: "chat" as const,
      },
    };
    expect((await connection.executeWorkspace(command)).outcome.status).toBe("accepted");
    expect((await connection.executeWorkspace(command)).outcome.status).toBe("accepted");
    expect(connection.workspace?.projects[0]?.tabs).toHaveLength(2);
    const result = await connection.requestAgent(
      {
        kind: "start",
        epoch: workspace.epoch,
        projectId: ids.project,
        expectedVersion: connection.workspace!.projects[0]!.version,
        tabId,
        paneId,
      },
      crypto.randomUUID(),
    );
    expect(result.outcome.status).toBe("ok");
    expect(connection.agents).toHaveLength(2);
    const stale = await connection.executeWorkspace({
      ...command,
      commandId: crypto.randomUUID(),
      operation: {
        kind: "tab.rename",
        projectId: ids.project,
        expectedVersion: workspace.projects[0]!.version,
        tabId,
        name: "Stale",
      },
    });
    expect(stale.outcome.status).toBe("rejected");
    connection.disconnect();
  });
  it("handshakes, reads history, responds to approval, and reconnects without changing pane layout", async () => {
    const server = createDemoServer();
    const connect = async () => {
      const connection = new DaemonConnection({
        endpoint: describeDaemonEndpoint("wss://demo.invalid/ws"),
        client: { kind: "mobile", name: "demo-test", version: "0.1.0" },
        webSocketFactory: server.socket,
      });
      connection.subscribeWorkspace(() => undefined);
      await connection.connect();
      await Promise.resolve();
      return connection;
    };
    const first = await connect();
    const before = first.workspace;
    expect(before?.projects[0]?.tabs[0]?.nodes).toHaveLength(3);
    const result = await first.requestAgent(
      { kind: "respond", sessionId: ids.agent, pendingId: ids.approval, decision: "accept" },
      crypto.randomUUID(),
    );
    expect(result.outcome.status).toBe("ok");
    first.disconnect();
    const second = await connect();
    expect(second.agents[0]?.pending).toEqual([]);
    expect(second.workspace).toEqual(before);
    second.disconnect();
  });
});
