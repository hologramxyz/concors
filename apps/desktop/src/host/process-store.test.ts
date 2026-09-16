import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection, ConnectionState } from "@concors/daemon-client";
import { createProcessStore } from "./process-store";

afterEach(() => vi.useRealTimers());
function fixture() {
  let stateListener: (state: ConnectionState) => void = () => undefined;
  const connection: Parameters<typeof createProcessStore>[0] = {
    state: {
      status: "ready",
      daemon: {
        protocolVersion: "v1",
        daemonVersion: "0.1.0",
        status: "ready",
        capabilities: ["machine-resources"],
      },
    },
    workspace: {
      schemaVersion: 1,
      machineId: "11111111-1111-4111-8111-111111111111",
      epoch: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      projects: [],
      selection: null,
    },
    requestResource: vi.fn<DaemonConnection["requestResource"]>(async (_, requestId) => ({
      type: "resource.result",
      requestId,
      outcome: {
        status: "processes",
        snapshot: { sampledAt: Date.now(), processes: [], warnings: [] },
      },
    })),
    subscribe: (listener) => {
      stateListener = listener;
      listener(connection.state);
      return () => undefined;
    },
    subscribeWorkspace: () => () => undefined,
  };
  return {
    connection,
    disconnect: () => {
      Object.assign(connection, { state: { status: "disconnected" } });
      stateListener(connection.state);
    },
  };
}
it("shares one polling loop and stops after the last observer", async () => {
  vi.useFakeTimers();
  const { connection } = fixture();
  const store = createProcessStore(connection);
  const first = store.subscribe(vi.fn());
  const second = store.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(connection.requestResource).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(connection.requestResource).toHaveBeenCalledTimes(2);
  first();
  second();
  await vi.advanceTimersByTimeAsync(9000);
  expect(connection.requestResource).toHaveBeenCalledTimes(2);
});
it("clears readings on disconnect and ignores requests resolving after disposal", async () => {
  vi.useFakeTimers();
  const { connection, disconnect } = fixture();
  const store = createProcessStore(connection);
  const off = store.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getSnapshot().snapshot).not.toBeNull();
  disconnect();
  expect(store.getSnapshot().snapshot).toBeNull();
  off();
  const next = fixture();
  let finish: (result: Awaited<ReturnType<DaemonConnection["requestResource"]>>) => void = () =>
    undefined;
  vi.mocked(next.connection.requestResource).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pendingStore = createProcessStore(next.connection);
  const dispose = pendingStore.subscribe(vi.fn());
  dispose();
  finish({
    type: "resource.result",
    requestId: "id",
    outcome: { status: "processes", snapshot: { sampledAt: 1, processes: [], warnings: [] } },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(pendingStore.getSnapshot().snapshot).toBeNull();
});
