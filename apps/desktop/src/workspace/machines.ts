import { HOSTS_STORAGE_KEY, HostSchema, parseHosts, type Host } from "@concors/client-core";
export {
  HOSTS_STORAGE_KEY,
  HostSchema,
  LOCAL_HOST,
  parseHosts,
  preferredConnection,
  machineAvailability,
  machineHost,
  type Host,
  type Connection,
  type HostAvailability,
} from "@concors/client-core";

/** Organization and account scope prevents another signed-in account inheriting these profiles. */
export function loadHosts(scope: string): Host[] {
  try {
    return parseHosts(localStorage.getItem(`${HOSTS_STORAGE_KEY}:${scope}`));
  } catch {
    return [];
  }
}
export function saveHost(scope: string, host: Host): void {
  try {
    localStorage.setItem(
      `${HOSTS_STORAGE_KEY}:${scope}`,
      JSON.stringify([
        ...loadHosts(scope).filter((h) => h.machineId !== host.machineId),
        HostSchema.parse(host),
      ]),
    );
  } catch {
    /* A storage failure must not prevent connecting. */
  }
}
