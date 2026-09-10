import { describe, expect, it, vi } from "vitest";
import {
  HOSTS_STORAGE_KEY,
  loadHosts,
  saveHost,
  LOCAL_HOST,
  machineAvailability,
  machineHost,
  parseHosts,
  preferredConnection,
} from "./machines";

const now = Date.parse("2026-09-10T12:00:00Z");
const machine = {
  id: "machine-1",
  name: "Build server",
  status: "running" as const,
  hostname: "m-example.dev.concors.app",
  agentSeenAt: new Date(now - 30_000).toISOString(),
};

describe("host profiles", () => {
  it("persists profiles per device/account/organization without retaining credentials", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const host = machineHost(machine);
      saveHost("user:org", host);
      saveHost("user:org", { ...host, label: "Updated" });
      expect(loadHosts("user:org")).toEqual([{ ...host, label: "Updated" }]);
      expect(loadHosts("other:org")).toEqual([]);
      expect(loadHosts("user:other")).toEqual([]);
      expect(storage.get(`${HOSTS_STORAGE_KEY}:user:org`)).not.toContain("token");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds stable direct connections from the API hostname and round-trips device preferences", () => {
    const host = machineHost(machine);
    expect(host).toEqual({
      machineId: "machine-1",
      label: "Build server",
      connections: [{ id: "direct", kind: "direct", url: "wss://m-example.dev.concors.app/ws" }],
      preferredConnectionId: "direct",
    });
    expect(parseHosts(JSON.stringify([LOCAL_HOST, host]))).toEqual([LOCAL_HOST, host]);
    expect(preferredConnection(LOCAL_HOST)).toEqual({ id: "local", kind: "local" });
    expect(
      machineHost({ ...machine, hostname: "new.dev.concors.app", name: "Renamed" }, host),
    ).toMatchObject({
      label: "Renamed",
      connections: [{ url: "wss://new.dev.concors.app/ws" }],
    });
  });
  it("keeps unassigned machines without a connection", () => {
    const host = machineHost({ ...machine, hostname: null });
    expect(host.connections).toEqual([]);
    expect(preferredConnection(host)).toBeUndefined();
  });
  it("ignores old URL bookmarks, corrupt storage and invalid preferences", () => {
    for (const raw of [
      null,
      "{",
      JSON.stringify([{ id: "old", name: "Old", url: "ws://localhost/ws" }]),
      JSON.stringify([{ ...LOCAL_HOST, preferredConnectionId: "missing" }]),
      JSON.stringify([{ ...LOCAL_HOST, machineId: "cloud" }]),
    ])
      expect(parseHosts(raw)).toEqual([]);
  });
});

describe("machine availability", () => {
  it.each([0, 30_000, 90_000])("connects when the last heartbeat is %i ms old", (age) => {
    expect(
      machineAvailability({ ...machine, agentSeenAt: new Date(now - age).toISOString() }, now),
    ).toBe("connectable");
  });
  it.each([90_001, 300_000, -1])(
    "rejects a heartbeat outside the last 90 seconds (%i ms)",
    (age) => {
      expect(
        machineAvailability({ ...machine, agentSeenAt: new Date(now - age).toISOString() }, now),
      ).toBe("offline");
    },
  );
  it("shows provisioning until the hostname and first heartbeat exist", () => {
    expect(machineAvailability({ ...machine, status: "provisioning" }, now)).toBe("provisioning");
    expect(machineAvailability({ ...machine, hostname: null }, now)).toBe("provisioning");
    expect(machineAvailability({ ...machine, agentSeenAt: null }, now)).toBe("provisioning");
    expect(machineAvailability({ ...machine, agentSeenAt: "invalid" }, now)).toBe("offline");
  });
  it.each(["stopped", "error", "deleted", "unknown"] as const)(
    "never connects to %s machines",
    (status) => {
      expect(machineAvailability({ ...machine, status }, now)).toBe("offline");
    },
  );
});
