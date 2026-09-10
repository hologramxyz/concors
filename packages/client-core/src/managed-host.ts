import { ApiError, type ApiClient, type Machine } from "@concors/api-client";
import {
  DaemonConnection,
  describeDaemonEndpoint,
  type WebSocketFactory,
} from "@concors/daemon-client";
import type { ClientInfo } from "@concors/protocol";
import { ConnectionAccessError } from "./connection.ts";
import { machineAvailability, machineHost, preferredConnection, type Host } from "./hosts.ts";
import type { MachineCredentialStore } from "./machine-credential-store.ts";

export function managedHost(machine: Machine, now = Date.now(), saved?: Host): Host {
  if (machineAvailability(machine, now) !== "connectable")
    throw new ConnectionAccessError(`This machine is ${machineAvailability(machine, now)}.`);
  return machineHost(machine, saved);
}

export interface ManagedConnectionOptions {
  scope: string;
  credentials: MachineCredentialStore;
  signal: AbortSignal;
  savedHost?: Host;
  saveHost?(host: Host): Promise<void>;
  webSocketFactory?: WebSocketFactory;
}

export async function createManagedConnection(
  api: Pick<ApiClient, "getMe" | "getMachine" | "mintMachineToken">,
  machineId: string,
  client: ClientInfo,
  options: ManagedConnectionOptions,
): Promise<DaemonConnection> {
  const credential = options.credentials.begin(options.scope, machineId);
  const clear = () => {
    void credential.clear().catch(() => undefined);
  };
  if (options.signal.aborted) throw new Error("Connection cancelled");
  options.signal.addEventListener("abort", clear, { once: true });
  try {
    const [me, machine] = await Promise.all([api.getMe(), api.getMachine(machineId)]);
    if (options.signal.aborted) throw new Error("Connection cancelled");
    if (machine.id !== machineId || machine.organizationId !== me.session.activeOrganizationId)
      throw new ConnectionAccessError("This machine is not available in your active organization.");
    const host = managedHost(machine, Date.now(), options.savedHost);
    const direct = preferredConnection(host);
    if (!direct || direct.kind !== "direct")
      throw new ConnectionAccessError("No managed connection is available.");
    await options.saveHost?.(host);
    if (options.signal.aborted) throw new Error("Connection cancelled");
    const { token } = await api.mintMachineToken(machineId);
    if (options.signal.aborted) throw new Error("Connection cancelled");
    try {
      await credential.save(token);
    } catch {
      throw new ConnectionAccessError("Could not save machine access securely. Retry connection.");
    }
    if (options.signal.aborted) throw new Error("Connection cancelled");
    return new DaemonConnection({
      endpoint: describeDaemonEndpoint(direct.url, host.label),
      client,
      protocols: [`concors.bearer.${token}`],
      ...(options.webSocketFactory ? { webSocketFactory: options.webSocketFactory } : {}),
    });
  } catch (cause) {
    options.signal.removeEventListener("abort", clear);
    await credential.clear().catch(() => undefined);
    if (cause instanceof ApiError && [403, 404].includes(cause.status))
      throw new ConnectionAccessError("Access revoked");
    throw cause;
  }
}
