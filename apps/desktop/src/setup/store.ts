import { useSyncExternalStore } from "react";

/**
 * Where first-run setup stands on this device, kept like keyboard shortcuts: per device, never
 * reported. Setup is remembered while it is open, not only once it ends, because two of its steps
 * leave the window behind: signing in replaces the whole app with the sign-in screen, and a cloud
 * machine is bought in the browser. Coming back, setup opens again where it was.
 */
export const SETUP_KEY = "concors.setup.v1";

export type SetupWhere = "local" | "cloud" | "server";

export type SetupRecord =
  | { readonly status: "done"; readonly outcome: "finished" | "skipped" }
  | {
      readonly status: "open";
      readonly step: number;
      /** What the first step chose, so the steps after it know which machine they set up. */
      readonly where?: SetupWhere;
      /** The machine bought or connected in the first step. */
      readonly machineId?: string;
      /** The cloud size picked before signing in, so it is still picked after. */
      readonly size?: string;
    }
  | { readonly status: "none" };

const NONE: SetupRecord = { status: "none" };

export function parseSetupRecord(raw: string | null): SetupRecord {
  if (!raw) return NONE;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value["status"] === "done")
      return {
        status: "done",
        outcome: value["outcome"] === "finished" ? "finished" : "skipped",
      };
    if (value["status"] === "open" && typeof value["step"] === "number") {
      const where = value["where"];
      return {
        status: "open",
        step: Math.max(0, Math.floor(value["step"])),
        ...(where === "local" || where === "cloud" || where === "server" ? { where } : {}),
        ...(typeof value["machineId"] === "string" ? { machineId: value["machineId"] } : {}),
        ...(typeof value["size"] === "string" ? { size: value["size"] } : {}),
      };
    }
  } catch {
    /* Unreadable: as if setup never ran. */
  }
  return NONE;
}

/**
 * Whether setup opens when the app is ready. It is decided once per launch from what was saved
 * and whether the machine already has workspaces: someone who already works in Concors is never
 * stopped by it, and a setup left open, by signing in or by quitting, comes back.
 */
export function opensSetup(record: SetupRecord, hasWorkspace: boolean): boolean {
  if (record.status === "open") return true;
  return record.status === "none" && !hasWorkspace;
}

const listeners = new Set<() => void>();
// Without storage, setup is remembered until the app reloads.
let fallback: string | null = null;
let snapshot: SetupRecord = NONE;
let snapshotRaw: string | null = null;

function read(): SetupRecord {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SETUP_KEY);
  } catch {
    raw = fallback;
  }
  // useSyncExternalStore compares snapshots by identity.
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = parseSetupRecord(raw);
  }
  return snapshot;
}

function write(record: SetupRecord) {
  const raw = JSON.stringify(record);
  fallback = raw;
  try {
    window.localStorage.setItem(SETUP_KEY, raw);
  } catch {
    /* Kept in memory instead; see `fallback`. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETUP_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSetupRecord(): SetupRecord {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

/** Opens setup at its first step, as a new device does, or from "Set up Concors" in the menus. */
export function startSetup() {
  write({ status: "open", step: 0 });
}

/** Keeps where an open setup is, so it comes back there. */
export function saveSetup(next: Omit<Extract<SetupRecord, { status: "open" }>, "status">) {
  write({ status: "open", ...next });
}

export function finishSetup(outcome: "finished" | "skipped") {
  write({ status: "done", outcome });
}
