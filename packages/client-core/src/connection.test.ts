import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DaemonConnection,
  describeDaemonEndpoint,
  type WebSocketLike,
} from "@concors/daemon-client";
import { ConnectionAccessError, ConnectionController } from "./connection.ts";

const machineId = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  schemaVersion: 1,
  machineId,
  epoch: machineId,
  revision: 1,
  projects: [],
  selection: null,
};
class Socket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  listeners = new Map<
    string,
    ((event: { data: unknown; code: number; reason: string }) => void)[]
  >();
  addEventListener(
    type: string,
    listener: (event: { data: unknown; code: number; reason: string }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
  event(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data, code: 1006, reason: "network lost" });
  }
  message(data: unknown) {
    this.event("message", JSON.stringify(data));
  }
  ready(id = machineId) {
    this.readyState = 1;
    this.event("open");
    this.message({
      type: "daemon.ready",
      protocolVersion: "v1",
      daemonVersion: "0.1.0",
      status: "ready",
    });
    this.message({ type: "workspace.snapshot", snapshot: { ...snapshot, machineId: id } });
  }
}
function setup() {
  const sockets: Socket[] = [];
  const create = vi.fn(
    async () =>
      new DaemonConnection({
        endpoint: describeDaemonEndpoint("wss://gateway.example/ws"),
        client: { kind: "mobile", name: "test", version: "0.1.0" },
        webSocketFactory: () => {
          const socket = new Socket();
          sockets.push(socket);
          return socket;
        },
      }),
  );
  const controller = new ConnectionController(create, machineId);
  return { controller, create, sockets };
}
afterEach(() => vi.useRealTimers());
describe("mobile connection lifecycle", () => {
  it("stops automatically retrying revoked access until the user retries", async () => {
    vi.useFakeTimers();
    const create = vi.fn(async () => {
      throw new ConnectionAccessError("Sign in again");
    });
    const controller = new ConnectionController(create);
    controller.setAvailable(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(create).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      message: "Sign in again",
      transport: null,
    });
    controller.retry();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(create).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("keeps a read-only snapshot in background and obtains fresh credentials on resume", async () => {
    const { controller, sockets, create } = setup();
    controller.setAvailable(true);
    await Promise.resolve();
    sockets[0]!.ready();
    expect(controller.getSnapshot().phase).toBe("ready");
    controller.setAvailable(false);
    expect(sockets[0]!.readyState).toBe(3);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "paused",
      transport: null,
      workspace: snapshot,
    });
    controller.setAvailable(true);
    await Promise.resolve();
    sockets[1]!.ready();
    expect(create).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().phase).toBe("ready");
    controller.dispose();
  });
  it("retries with backoff and ignores callbacks from a disconnected socket", async () => {
    vi.useFakeTimers();
    const { controller, sockets, create } = setup();
    controller.setAvailable(true);
    await Promise.resolve();
    sockets[0]!.ready();
    sockets[0]!.event("close");
    expect(controller.getSnapshot().phase).toBe("error");
    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    sockets[0]!.message({ type: "workspace.snapshot", snapshot: { ...snapshot, revision: 999 } });
    sockets[1]!.ready();
    expect(controller.getSnapshot().workspace?.revision).toBe(1);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("discards a connection ticket resolved after the user left the machine", async () => {
    const { sockets, create } = setup();
    let resolve: (connection: DaemonConnection) => void = () => undefined;
    const controller = new ConnectionController(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    controller.setAvailable(true);
    controller.dispose();
    resolve(await create());
    await Promise.resolve();
    expect(sockets).toHaveLength(0);
  });
  it("refuses workspace data from a different machine", async () => {
    const { controller, sockets } = setup();
    controller.setAvailable(true);
    await Promise.resolve();
    sockets[0]!.ready("22222222-2222-4222-8222-222222222222");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      workspace: null,
      transport: null,
    });
    controller.dispose();
  });
  it("times out a socket that never opens rather than hanging forever", async () => {
    vi.useFakeTimers();
    const { controller, sockets } = setup();
    controller.setAvailable(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(controller.getSnapshot().phase).toBe("error");
    expect(sockets[0]!.readyState).toBe(3);
    controller.dispose();
  });
});
