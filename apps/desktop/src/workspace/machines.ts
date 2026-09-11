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

const SELECTED_MACHINE_KEY = "concors.selected-machine.v1";
export function loadSelectedMachineId(scope: string): string | null {
  try {
    return localStorage.getItem(`${SELECTED_MACHINE_KEY}:${scope}`);
  } catch {
    return null;
  }
}
export function saveSelectedMachineId(scope: string, machineId: string): void {
  try {
    localStorage.setItem(`${SELECTED_MACHINE_KEY}:${scope}`, machineId);
  } catch {
    /* A storage failure must not prevent connecting. */
  }
}
