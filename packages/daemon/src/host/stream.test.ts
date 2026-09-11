import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, expect, it } from "vitest";
import { parseDaemonMessage, type DaemonMessage } from "@concors/protocol";
import { loadDaemonConfig } from "../config.ts";
import { createDaemonServer, type DaemonServer } from "../server.ts";

let server: DaemonServer | undefined;
afterEach(async () => {
  await server?.close();
});
const hello = {
  type: "client.hello",
  protocolVersion: "v1",
  client: { kind: "test", name: "host usage", version: "0.0.0" },
};
async function connect() {
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}));
  const url = await server.listen();
  const socket = new WebSocket(url.replace("http", "ws") + "/ws");
  const messages: DaemonMessage[] = [];
  socket.on("message", (raw) => {
    const result = parseDaemonMessage(raw.toString());
    if (result.success) messages.push(result.data);
  });
  await once(socket, "open");
  return { socket, messages, send: (message: unknown) => socket.send(JSON.stringify(message)) };
}

it("requires a handshake before exposing machine usage", async () => {
  const { socket, messages, send } = await connect();
  send({ type: "host.subscribe", enabled: true });
  await once(socket, "close");
  expect(messages).toMatchObject([{ type: "error", error: { code: "HANDSHAKE_REQUIRED" } }]);
});

it("streams real machine measurements only while opted in", async () => {
  const { socket, messages, send } = await connect();
  send(hello);
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toMatchObject({
    type: "daemon.ready",
    capabilities: expect.arrayContaining(["host-usage"]),
  });
  const readings = () => messages.filter((message) => message.type === "host.usage");
  expect(readings()).toHaveLength(0);
  send({ type: "host.subscribe", enabled: true });
  send({ type: "host.subscribe", enabled: true });
  await expect.poll(() => readings().length).toBe(1);
  expect(readings()[0]?.usage?.cpuPercent).toBeNull();
  await expect.poll(() => readings().length, { timeout: 4000 }).toBeGreaterThanOrEqual(2);
  expect(readings()[1]?.usage?.memory.totalBytes).toBeGreaterThan(0);
  send({ type: "host.subscribe", enabled: false });
  const count = readings().length;
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(readings()).toHaveLength(count);
  socket.close();
}, 10_000);
