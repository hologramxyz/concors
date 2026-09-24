import { afterEach, expect, it, vi } from "vitest";
import { createApiClient, memoryTokenStore, type Machine, type Me } from "@concors/api-client";
import type { WebSocketLike } from "@concors/daemon-client";
import { createManagedConnection, managedHost } from "./managed-host.ts";
import { ConnectionController } from "./connection.ts";
import { MachineCredentialStore } from "./machine-credential-store.ts";
import { machineAvailability, machineHost, parseHosts } from "./hosts.ts";
const now = Date.now();
const machine: Machine = {
  id: "cloud-machine",
  organizationId: "org",
  createdByUserId: "user",
  name: "Development",
  region: "test",
  size: "small",
  serviceName: null,
  orderId: null,
  status: "running",
  ovhState: null,
  lastError: null,
  ipv4: null,
  ipv6: null,
  sshUser: "ubuntu",
  accessReadyAt: null,
  reinstallTaskId: null,
  monthlyPrice: null,
  paidUntil: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  hostname: "m-test.concors.app",
  certificateExpiresAt: new Date(now + 86400_000).toISOString(),
  agentSeenAt: new Date(now).toISOString(),
  agentVersion: "0.2.0",
};
const me: Me = {
  user: {
    id: "user",
    name: "User",
    email: "user@example.test",
    emailVerified: true,
    image: null,
    createdAt: "",
    updatedAt: "",
  },
  session: {
    id: "session",
    activeOrganizationId: "org",
    expiresAt: new Date(now + 86400_000).toISOString(),
  },
};
const client = { kind: "mobile" as const, name: "test", version: "0.1.0" };
class Socket implements WebSocketLike {
  readyState = 0;
  send = vi.fn();
  close = vi.fn();
  listeners = new Map<string, ((event: never) => void)[]>();
  addEventListener(type: string, listener: (event: never) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
  ready() {
    this.emit("open");
    this.emit("message", {
      data: JSON.stringify({
        type: "daemon.ready",
        protocolVersion: "v1",
        daemonVersion: "0.2.0",
        status: "ready",
      }),
    });
  }
}
const snapshot = {
  schemaVersion: 1,
  machineId: "00000000-0000-4000-8000-000000000001",
  epoch: "00000000-0000-4000-8000-000000000002",
  revision: 0,
  projects: [],
  selection: null,
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});
function setup({
  tokenStatus = 201,
  socketStatus,
}: { tokenStatus?: number; socketStatus?: number } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const mint = vi.fn(async () => json({ token: `token-${mint.mock.calls.length}` }, tokenStatus));
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/token")) return mint();
    if (url.endsWith("/me")) return json(me);
    if (url.endsWith("/machines")) return json({ machines: [machine] });
    return json({ machine });
  });
  const api = createApiClient({
    baseUrl: "https://api.example",
    tokenStore: memoryTokenStore("session"),
    fetch,
  });
  const write = vi.fn(async (_value: string | null) => undefined);
  const credentials = new MachineCredentialStore({ read: async () => null, write });
  const sockets: Socket[] = [];
  const webSocketFactory = vi.fn(() => {
    if (socketStatus) throw { status: socketStatus };
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  const saveHost = vi.fn(async (_host: unknown) => undefined);
  const controller = new ConnectionController((signal) => {
    // React Native's installed abort-controller polyfill lacks throwIfAborted.
    Object.defineProperty(signal, "throwIfAborted", { value: undefined });
    return createManagedConnection(api, machine.id, client, {
      scope: "user:org",
      signal,
      credentials,
      webSocketFactory,
      saveHost,
    });
  });
  disposers.push(() => controller.dispose());
  controller.setAvailable(true);
  return { api, fetch, mint, controller, sockets, write, webSocketFactory, saveHost };
}
const flush = () => vi.advanceTimersByTimeAsync(1);
it("discovers hosts through the API, persists no credentials in profiles, and connects with a securely saved token", async () => {
  const t = setup();
  const [record] = await t.api.listMachines();
  const host = managedHost(record!, now);
  expect(host).toEqual({
    machineId: machine.id,
    label: machine.name,
    connections: [{ id: "direct", kind: "direct", url: "wss://m-test.concors.app/ws" }],
    preferredConnectionId: "direct",
  });
  expect(parseHosts(JSON.stringify([host]))).toEqual([host]);
  await flush();
  expect(t.fetch).toHaveBeenCalledWith(
    "https://api.example/api/v1/machines/cloud-machine/token",
    expect.objectContaining({ method: "POST" }),
  );
  expect(t.write).toHaveBeenCalledWith(
    JSON.stringify({ scope: "user:org", machineId: machine.id, token: "token-1" }),
  );
  expect(t.webSocketFactory).toHaveBeenCalledWith("wss://m-test.concors.app/ws", [
    "concors.bearer.token-1",
  ]);
  expect(t.write.mock.invocationCallOrder[0]).toBeLessThan(
    t.webSocketFactory.mock.invocationCallOrder[0]!,
  );
  expect(JSON.stringify(t.saveHost.mock.calls)).not.toContain("token-1");
  t.sockets[0]!.ready();
  t.sockets[0]!.emit("message", { data: JSON.stringify({ type: "workspace.snapshot", snapshot }) });
  expect(t.controller.getSnapshot().workspace).toEqual(snapshot);
  t.controller.setAvailable(false);
  await flush();
  expect(t.write).toHaveBeenLastCalledWith(null);
});
it.each([
  [{ status: "provisioning" }, "provisioning"],
  [{ status: "stopped" }, "offline"],
  [{ hostname: null }, "provisioning"],
  [{ agentSeenAt: null }, "provisioning"],
  [{ agentSeenAt: new Date(now - 90_000).toISOString() }, "connectable"],
  [{ agentSeenAt: new Date(now - 90_001).toISOString() }, "offline"],
  // A device clock behind the server's must not turn a fresh heartbeat into "offline".
  [{ agentSeenAt: new Date(now + 5_000).toISOString() }, "connectable"],
  [{ agentSeenAt: new Date(now + 5 * 60_000).toISOString() }, "connectable"],
  [{ agentSeenAt: new Date(now + 5 * 60_000 + 1).toISOString() }, "offline"],
  [{ certificateExpiresAt: null, agentVersion: null }, "connectable"],
] as const)("uses C1 availability for %j", (overrides, expected) => {
  expect(machineAvailability({ ...machine, ...overrides }, now)).toBe(expected);
});
it("rebuilds persisted URLs from authoritative discovery", () => {
  const saved = machineHost({ ...machine, hostname: "old.example" });
  expect(machineHost(machine, saved).connections).toEqual([
    { id: "direct", kind: "direct", url: "wss://m-test.concors.app/ws" },
  ]);
  expect(() => machineHost({ ...machine, hostname: "evil.example/path" })).toThrow();
});
it.each([false, true])(
  "re-mints once on 4401 then blocks lifecycle retries (ready: %s)",
  async (ready) => {
    const t = setup();
    await flush();
    if (ready) t.sockets[0]!.ready();
    t.sockets[0]!.emit("close", { code: 4401, reason: "expired" });
    await flush();
    expect(t.mint).toHaveBeenCalledTimes(2);
    t.sockets[1]!.emit("close", { code: 4401, reason: "revoked" });
    await flush();
    expect(t.controller.getSnapshot()).toMatchObject({
      phase: "error",
      message: "Access revoked",
      transport: null,
    });
    t.controller.setAvailable(false);
    t.controller.setAvailable(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.mint).toHaveBeenCalledTimes(2);
    expect(t.write).toHaveBeenLastCalledWith(null);
    t.controller.retry();
    await flush();
    expect(t.mint).toHaveBeenCalledTimes(3);
  },
);
it.each(["api", "socket"])("limits HTTP 401 retries from %s", async (source) => {
  const t = setup(source === "api" ? { tokenStatus: 401 } : { socketStatus: 401 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(t.mint).toHaveBeenCalledTimes(2);
  expect(t.controller.getSnapshot().message).toBe("Access revoked");
});
it("allows later expiry episodes after successful authentication", async () => {
  const t = setup();
  await flush();
  for (let index = 0; index < 3; index++) {
    t.sockets[index]!.ready();
    t.sockets[index]!.emit("close", { code: 4401, reason: "expired" });
    await flush();
  }
  expect(t.mint).toHaveBeenCalledTimes(4);
});
it("bounds opaque browser upgrades without misreporting a network failure as certain revocation", async () => {
  const t = setup();
  await flush();
  t.sockets[0]!.emit("error");
  await flush();
  t.sockets[1]!.emit("error");
  await flush();
  expect(t.controller.getSnapshot().message).toContain("offline or access revoked");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(t.mint).toHaveBeenCalledTimes(2);
});
it.each([403, 404])("does not retry forbidden/missing machines: %s", async (tokenStatus) => {
  const t = setup({ tokenStatus });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(t.mint).toHaveBeenCalledTimes(1);
  expect(t.controller.getSnapshot().message).toBe("Access revoked");
});
it("does not open a socket when secure persistence fails", async () => {
  const t = setup();
  t.write.mockRejectedValue(new Error("keychain unavailable"));
  await flush();
  expect(t.webSocketFactory).not.toHaveBeenCalled();
  expect(t.controller.getSnapshot().message).toContain("securely");
});
it("discards a mint that finishes after backgrounding or switching accounts", async () => {
  const t = setup();
  let resolve!: (response: Response) => void;
  t.mint.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await flush();
  t.controller.dispose();
  resolve(json({ token: "late-secret" }));
  await flush();
  expect(t.webSocketFactory).not.toHaveBeenCalled();
  expect(JSON.stringify(t.write.mock.calls)).not.toContain("late-secret");
});
it("rejects records outside the active organization before minting", async () => {
  const t = setup();
  t.fetch.mockImplementation(async (url) =>
    String(url).endsWith("/me")
      ? json(me)
      : json({ machine: { ...machine, organizationId: "other" } }),
  );
  t.controller.retry();
  await flush();
  expect(t.mint).not.toHaveBeenCalled();
  expect(t.controller.getSnapshot().message).toContain("active organization");
});
