import { ApiError, type ApiClient, type Machine } from "@concors/api-client";
import {
  DaemonConnection,
  describeDaemonEndpoint,
  type WebSocketFactory,
} from "@concors/daemon-client";
import type { ClientInfo } from "@concors/protocol";
import { ConnectionAccessError } from "./connection.ts";

/** Cloud identity is NOT workspace.machineId (the daemon's persistent workspace namespace). */
export interface HostProfile {
  id: string;
  label: string;
  connections: ({ id: string; kind: "local" } | { id: string; kind: "direct"; url: string })[];
  preferredConnectionId: string;
}

export function managedHost(machine: Machine, now = Date.now()): HostProfile {
  if (
    machine.status !== "running" ||
    (machine.cancelledAt && !(Date.parse(machine.paidUntil ?? "") > now))
  )
    throw new ConnectionAccessError("This machine is not running or its access period has ended.");
  const hostname = machine.hostname;
  if (
    !hostname ||
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)
  )
    throw new ConnectionAccessError("This machine does not have a valid managed hostname yet.");
  if (!(Date.parse(machine.certificateExpiresAt ?? "") > now))
    throw new ConnectionAccessError(
      "The machine certificate is not ready. Refresh its status before connecting.",
    );
  const seen = Date.parse(machine.agentSeenAt ?? "");
  if (!Number.isFinite(seen) || now - seen > 90_000 || seen > now + 30_000)
    throw new ConnectionAccessError(
      "The machine is offline or has not sent a recent heartbeat. Refresh and try again.",
    );
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(machine.agentVersion ?? "");
  if (!version || (Number(version[1]) === 0 && Number(version[2]) < 2))
    throw new ConnectionAccessError(
      "Update this machine to the managed workspace daemon before connecting.",
    );
  return {
    id: machine.id,
    label: machine.name,
    connections: [{ id: "managed-direct", kind: "direct", url: `wss://${hostname}/ws` }],
    preferredConnectionId: "managed-direct",
  };
}

export async function createManagedConnection(
  api: Pick<ApiClient, "getMe" | "getMachine" | "getMobileCapabilities" | "getMachineAccessToken">,
  machineId: string,
  client: ClientInfo,
  webSocketFactory?: WebSocketFactory,
): Promise<DaemonConnection> {
  try {
    const [me, machine, capabilities] = await Promise.all([
      api.getMe(),
      api.getMachine(machineId),
      api.getMobileCapabilities(),
    ]);
    if (!capabilities.remoteAccess)
      throw new ConnectionAccessError(
        "Managed workspace access is not enabled on this server yet.",
      );
    if (machine.id !== machineId || machine.organizationId !== me.session.activeOrganizationId)
      throw new ConnectionAccessError("This machine is not available in your active organization.");
    const host = managedHost(machine);
    const direct = host.connections.find(
      (connection) => connection.id === host.preferredConnectionId,
    );
    if (!direct || direct.kind !== "direct")
      throw new ConnectionAccessError("No managed connection is available.");
    // Mint at the last possible moment; never persist short-lived machine credentials or send them to the renderer.
    const access = await api.getMachineAccessToken(machineId);
    if (
      access.machineId !== machineId ||
      !(Date.parse(access.expiresAt) > Date.now() + 5000) ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access.token)
    )
      throw new ConnectionAccessError("The machine access credential is invalid or expired.");
    return new DaemonConnection({
      endpoint: describeDaemonEndpoint(direct.url),
      client,
      protocols: [`concors.bearer.${access.token}`],
      ...(webSocketFactory ? { webSocketFactory } : {}),
    });
  } catch (cause) {
    if (cause instanceof ApiError && [401, 403, 404].includes(cause.status))
      throw new ConnectionAccessError(
        "Your session or machine access is no longer valid. Sign in again or select another machine.",
      );
    throw cause;
  }
}
