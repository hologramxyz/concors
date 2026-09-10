import { expect, it, vi } from "vitest";
import { ApiError, type Machine, type Me } from "@concors/api-client";
import { createManagedConnection, managedHost } from "./managed-host.ts";
import { ConnectionAccessError } from "./connection.ts";

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
function api() {
  return {
    getMe: vi.fn(async () => me),
    getMachine: vi.fn(async () => machine),
    getMobileCapabilities: vi.fn(async () => ({
      version: 1 as const,
      remoteAccess: true,
      pushNotifications: false,
      accountDeletion: false,
    })),
    getMachineAccessToken: vi.fn(async () => ({
      machineId: machine.id,
      token: "header.payload.signature",
      expiresAt: new Date(now + 900_000).toISOString(),
    })),
  };
}
it("builds a credential-free direct host from the authenticated machine record", () => {
  expect(managedHost(machine, now)).toEqual({
    id: "cloud-machine",
    label: "Development",
    connections: [{ id: "managed-direct", kind: "direct", url: "wss://m-test.concors.app/ws" }],
    preferredConnectionId: "managed-direct",
  });
});
it.each([
  { status: "stopped" },
  { hostname: null },
  { hostname: "evil.test/ws?token=x" },
  { hostname: "user@evil.test" },
  { hostname: "127.0.0.1" },
  { hostname: "localhost:7420" },
  { certificateExpiresAt: null },
  { certificateExpiresAt: new Date(now - 1).toISOString() },
  { agentSeenAt: null },
  { agentSeenAt: new Date(now - 90_001).toISOString() },
  { agentSeenAt: new Date(now + 31_000).toISOString() },
  { agentVersion: "0.1.0" },
  { agentVersion: null },
  { cancelledAt: new Date(now).toISOString(), paidUntil: null },
] satisfies Partial<Machine>[])(
  "rejects unavailable or unsafe machine metadata: %j",
  (overrides) => {
    expect(() => managedHost({ ...machine, ...overrides }, now)).toThrow(ConnectionAccessError);
  },
);
it("mints on every connection and passes credentials only as a WebSocket subprotocol", async () => {
  const control = api();
  const factory = vi.fn(() => {
    throw new Error("private transport error with token");
  });
  for (let index = 0; index < 2; index++) {
    const connection = await createManagedConnection(control, machine.id, client, factory);
    expect(connection.endpoint.url).toBe("wss://m-test.concors.app/ws");
    await expect(connection.connect()).rejects.toThrow("Could not open WebSocket");
    expect(JSON.stringify(connection.state)).not.toContain("private transport error");
  }
  expect(control.getMachineAccessToken).toHaveBeenCalledTimes(2);
  expect(factory).toHaveBeenCalledWith("wss://m-test.concors.app/ws", [
    "concors.bearer.header.payload.signature",
  ]);
});
it("refuses cross-organization records and disabled discovery before minting credentials", async () => {
  const control = api();
  control.getMachine.mockResolvedValue({ ...machine, organizationId: "other" });
  await expect(createManagedConnection(control, machine.id, client)).rejects.toThrow(
    "active organization",
  );
  control.getMachine.mockResolvedValue(machine);
  control.getMobileCapabilities.mockResolvedValue({
    version: 1,
    remoteAccess: false,
    pushNotifications: false,
    accountDeletion: false,
  });
  await expect(createManagedConnection(control, machine.id, client)).rejects.toThrow("not enabled");
  expect(control.getMachineAccessToken).not.toHaveBeenCalled();
});
it.each([401, 403, 404])(
  "stops retrying HTTP %s without exposing upstream messages",
  async (status) => {
    const control = api();
    control.getMachineAccessToken.mockRejectedValue(new ApiError(status, "private server detail"));
    await expect(createManagedConnection(control, machine.id, client)).rejects.toThrow(
      ConnectionAccessError,
    );
    await expect(createManagedConnection(control, machine.id, client)).rejects.not.toThrow(
      "private server detail",
    );
  },
);
it("rejects a substituted or expired credential", async () => {
  const control = api();
  for (const credential of [
    {
      machineId: "other",
      token: "header.payload.signature",
      expiresAt: new Date(now + 60_000).toISOString(),
    },
    {
      machineId: machine.id,
      token: "header.payload.signature",
      expiresAt: new Date(now - 1).toISOString(),
    },
  ]) {
    control.getMachineAccessToken.mockResolvedValue(credential);
    await expect(createManagedConnection(control, machine.id, client)).rejects.toThrow(
      "invalid or expired",
    );
  }
});
