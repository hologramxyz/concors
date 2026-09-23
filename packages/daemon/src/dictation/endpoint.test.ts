import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import {
  DICTATION_CAPABILITY,
  PROTOCOL_VERSION,
  WS_PATH,
  parseDaemonMessage,
  type DaemonMessage,
} from "@concors/protocol";
import { afterEach, expect, it } from "vitest";
import { loadDaemonConfig } from "../config.ts";
import { createDaemonServer, type DaemonServer } from "../server.ts";

const client = { kind: "test", name: "dictation-tests", version: "0.0.0" } as const;
let server: DaemonServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
  server = root = undefined;
});

async function start(withModels: boolean): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "concors-dictation-endpoint-"));
  server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
    ...(withModels ? { speechModelsDirectory: join(root, "models") } : {}),
  });
  return server.listen();
}

it("offers dictation only where the daemon can keep a speech model", async () => {
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(await start(false)),
    client,
  });
  expect((await connection.connect()).capabilities).not.toContain(DICTATION_CAPABILITY);
  expect(connection.dictation).toBe(false);
  connection.disconnect();
  await server?.close();

  const ready = new DaemonConnection({
    endpoint: describeDaemonEndpoint(await start(true)),
    client,
  });
  expect((await ready.connect()).capabilities).toContain(DICTATION_CAPABILITY);
  const status = await ready.requestDictation({ kind: "status" }, crypto.randomUUID());
  expect(status.outcome).toEqual({ status: "ok", model: { state: "missing" } });
  ready.disconnect();
});

it("keeps dictation messages away from clients that did not ask for them", async () => {
  const url = await start(true);
  const messages: DaemonMessage[] = [];
  const socket = new WebSocket(`${url.replace(/^http/, "ws")}${WS_PATH}`);
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  socket.addEventListener("message", (event) => {
    const parsed = parseDaemonMessage(String(event.data));
    if (parsed.success) messages.push(parsed.data);
  });
  socket.send(JSON.stringify({ type: "client.hello", protocolVersion: PROTOCOL_VERSION, client }));
  socket.send(
    JSON.stringify({
      type: "dictation.request",
      requestId: crypto.randomUUID(),
      operation: { kind: "status" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.close();
  expect(messages.map((message) => message.type)).toEqual(["daemon.ready", "error"]);
});
