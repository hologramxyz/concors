import { describe, expect, it } from "vitest";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { createDemoServer } from "./server";
import { ids } from "./fixtures";
describe("mobile demo protocol fixture", () => {
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
