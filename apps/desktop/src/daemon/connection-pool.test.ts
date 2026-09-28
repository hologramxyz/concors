import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type { WorkspaceSnapshot } from "@concors/protocol";

import { HostConnectionPool, type HostHandlers, type HostSession } from "./connection-pool";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeHost() {
  let handlers: HostHandlers | undefined;
  const session: HostSession = {
    reconnect: vi.fn(),
    resume: vi.fn(),
    wake: vi.fn(),
    offline: vi.fn(),
    dispose: vi.fn(() => handlers?.onTransport(null)),
  };
  const open = vi.fn((next: HostHandlers) => {
    handlers = next;
    next.onTransport({ endpoint: { url: "wss://a/ws" } } as DaemonConnection);
    return session;
  });
  return {
    session,
    open,
    get handlers() {
      if (!handlers) throw new Error("not opened");
      return handlers;
    },
  };
}
const target = (machineId: string, scope = "alice:org") => ({
  key: `${scope}:${machineId}:wss://${machineId}/ws`,
  scope,
  machineId,
});
const workspace = { machineId: "vps", epoch: "1", projects: [] } as unknown as WorkspaceSnapshot;

it("reuses a released connection with its live workspace instead of reconnecting", () => {
  const pool = new HostConnectionPool({ idleMs: 60_000, maxIdle: 2 });
  const host = fakeHost();
  const release = pool.acquire(target("vps"), host.open, () => undefined);
  host.handlers.onState({ status: "ready", daemon: {} as never }, false);
  host.handlers.onWorkspace(workspace);
  release();

  vi.advanceTimersByTime(59_000);
  const listener = vi.fn();
  pool.acquire(target("vps"), host.open, listener);
  expect(host.open).toHaveBeenCalledTimes(1);
  expect(host.session.dispose).not.toHaveBeenCalled();
  expect(host.session.reconnect).not.toHaveBeenCalled();
  expect(pool.peek(target("vps").key)).toMatchObject({ workspace, workspaceReady: true });
  // The idle timer was cancelled by reuse.
  vi.advanceTimersByTime(120_000);
  expect(host.session.dispose).not.toHaveBeenCalled();
});

it("shares one connection between users and only idles it when the last lets go", () => {
  const pool = new HostConnectionPool({ idleMs: 1_000, maxIdle: 2 });
  const host = fakeHost();
  const a = pool.acquire(target("vps"), host.open, () => undefined);
  const b = pool.acquire(target("vps"), host.open, () => undefined);
  expect(host.open).toHaveBeenCalledTimes(1);
  a();
  a();
  vi.advanceTimersByTime(5_000);
  expect(host.session.dispose).not.toHaveBeenCalled();
  b();
  vi.advanceTimersByTime(999);
  expect(host.session.dispose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(host.session.dispose).toHaveBeenCalledTimes(1);
  expect(pool.peek(target("vps").key)).toBeUndefined();
});

it("closes the oldest idle connections beyond the cap", () => {
  const pool = new HostConnectionPool({ idleMs: 60_000, maxIdle: 1 });
  const first = fakeHost();
  const second = fakeHost();
  pool.acquire(target("one"), first.open, () => undefined)();
  vi.advanceTimersByTime(10);
  pool.acquire(target("two"), second.open, () => undefined)();
  expect(first.session.dispose).toHaveBeenCalled();
  expect(second.session.dispose).not.toHaveBeenCalled();
});

it("never keeps a connection that belongs to another account", () => {
  const pool = new HostConnectionPool({ idleMs: 60_000, maxIdle: 4 });
  const alice = fakeHost();
  const aliceBusy = fakeHost();
  pool.setScope("alice:org");
  pool.acquire(target("idle", "alice:org"), alice.open, () => undefined)();
  const releaseBusy = pool.acquire(target("busy", "alice:org"), aliceBusy.open, () => undefined);
  pool.setScope("");
  expect(alice.session.dispose).toHaveBeenCalled();
  expect(aliceBusy.session.dispose).not.toHaveBeenCalled();
  releaseBusy();
  expect(aliceBusy.session.dispose).toHaveBeenCalled();
});

it("retries at once when someone comes back to a machine that was failing", () => {
  const pool = new HostConnectionPool({ idleMs: 60_000, maxIdle: 4 });
  const host = fakeHost();
  pool.acquire(target("vps"), host.open, () => undefined)();
  host.handlers.onState(
    { status: "error", error: { code: "INTERNAL_ERROR", message: "x" } },
    false,
  );
  pool.acquire(target("vps"), host.open, () => undefined);
  expect(host.session.reconnect).toHaveBeenCalledTimes(1);
});

it("tracks when a drop started restoring and reports ready machines", () => {
  let now = 1_000;
  const pool = new HostConnectionPool({ idleMs: 60_000, maxIdle: 4, now: () => now });
  const host = fakeHost();
  const watcher = vi.fn();
  pool.watch(watcher);
  pool.acquire(target("vps"), host.open, () => undefined);
  host.handlers.onState({ status: "ready", daemon: {} as never }, false);
  host.handlers.onWorkspace(workspace);
  expect(pool.readyMachines("alice:org")).toEqual(new Set(["vps"]));
  expect(pool.readyMachines("bob:org").size).toBe(0);
  expect(watcher).toHaveBeenCalled();

  host.handlers.onState({ status: "connecting" }, true);
  now = 5_000;
  host.handlers.onState({ status: "disconnected" }, true);
  expect(pool.peek(target("vps").key)).toMatchObject({
    restoringSince: 1_000,
    workspaceReady: false,
  });
  expect(pool.readyMachines("alice:org").size).toBe(0);
  host.handlers.onState({ status: "ready", daemon: {} as never }, false);
  expect(pool.peek(target("vps").key)?.restoringSince).toBeNull();
});
