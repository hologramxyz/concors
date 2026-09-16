import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { createDaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";

it("requires a workspace subscription before resource inspection or mutation", async () => {
  const server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
  try {
    const url = await server.listen();
    const socket = new WebSocket(url.replace("http", "ws") + "/ws");
    await once(socket, "open");
    const hello = once(socket, "message");
    socket.send(
      JSON.stringify({
        type: "client.hello",
        protocolVersion: "v1",
        client: { kind: "test", name: "resources", version: "0.0.0" },
      }),
    );
    await hello;
    const reply = once(socket, "message");
    socket.send(
      JSON.stringify({
        type: "resource.request",
        requestId: crypto.randomUUID(),
        operation: { kind: "processes" },
      }),
    );
    const [message] = await reply;
    expect(JSON.parse(String(message))).toMatchObject({
      type: "error",
      error: { code: "INVALID_MESSAGE" },
    });
    socket.close();
  } finally {
    await server.close();
  }
});
it("round-trips real process inventory and safely rejects unknown cleanup candidates", async () => {
  const server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
  const url = await server.listen();
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "resources", version: "0.0.0" },
  });
  const off = connection.subscribeWorkspace(() => undefined);
  try {
    await connection.connect();
    await expect.poll(() => connection.workspace).not.toBeNull();
    const snapshot = await connection.requestResource({ kind: "processes" }, crypto.randomUUID());
    expect(snapshot.outcome.status).toBe("processes");
    const rejected = await connection.requestResource(
      { kind: "cleanup", id: crypto.randomUUID(), confirmation: "/tmp" },
      crypto.randomUUID(),
    );
    expect(rejected.outcome).toMatchObject({ status: "error" });
  } finally {
    off();
    connection.disconnect();
    await server.close();
  }
});
