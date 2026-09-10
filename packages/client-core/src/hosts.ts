import type { Machine } from "@concors/api-client";
import { z } from "zod";

const ConnectionSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1), kind: z.literal("local") }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("direct"),
    url: z.url().refine((url) => {
      const parsed = new URL(url);
      return (
        parsed.protocol === "wss:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      );
    }),
  }),
]);
export type Connection = z.infer<typeof ConnectionSchema>;
export const HostSchema = z
  .object({
    machineId: z.string().min(1),
    label: z.string().trim().min(1),
    connections: z.array(ConnectionSchema),
    preferredConnectionId: z.string().nullable(),
  })
  .refine(
    (host) =>
      new Set(host.connections.map((c) => c.id)).size === host.connections.length &&
      (host.preferredConnectionId === null ||
        host.connections.some((c) => c.id === host.preferredConnectionId)) &&
      host.connections.every((c) => (c.kind === "local") === (host.machineId === "local")),
  );
export type Host = z.infer<typeof HostSchema>;
export const LOCAL_HOST: Host = {
  machineId: "local",
  label: "This computer",
  connections: [{ id: "local", kind: "local" }],
  preferredConnectionId: "local",
};
export const HOSTS_STORAGE_KEY = "concors.hosts.v1";

/** Old URL bookmarks cannot identify a managed machine and are deliberately not migrated. */
export function parseHosts(raw: string | null): Host[] {
  try {
    return z.array(HostSchema).parse(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}

export function preferredConnection(host: Host): Connection | undefined {
  return host.connections.find((c) => c.id === host.preferredConnectionId) ?? host.connections[0];
}

export type HostAvailability = "connectable" | "provisioning" | "offline";
/** An online machine is not necessarily the one this device has connected to. */
export function machineStatusLabel(availability: HostAvailability, connected = false): string {
  if (connected) return "Connected";
  return { connectable: "Online", provisioning: "Provisioning", offline: "Offline" }[availability];
}
export function machineAvailability(
  machine: Pick<Machine, "status" | "hostname" | "agentSeenAt">,
  now = Date.now(),
): HostAvailability {
  if (machine.status === "provisioning") return "provisioning";
  if (machine.status !== "running") return "offline";
  if (!machine.hostname || !machine.agentSeenAt) return "provisioning";
  const age = now - Date.parse(machine.agentSeenAt);
  return age >= 0 && age <= 90_000 ? "connectable" : "offline";
}

/** URLs and labels are refreshed from the API, never trusted from persisted profiles. */
export function machineHost(
  machine: Pick<Machine, "id" | "name" | "hostname">,
  saved?: Host,
): Host {
  if (
    machine.hostname &&
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(machine.hostname)
  )
    throw new Error("Invalid managed hostname");
  const connections: Connection[] = machine.hostname
    ? [{ id: "direct", kind: "direct", url: `wss://${machine.hostname}/ws` }]
    : [];
  return HostSchema.parse({
    machineId: machine.id,
    label: machine.name,
    connections,
    preferredConnectionId:
      connections.find((c) => c.id === saved?.preferredConnectionId)?.id ??
      connections[0]?.id ??
      null,
  });
}
