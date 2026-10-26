import { MobileTargetSchema, type MobileTarget } from "@concors/client-core";
import { z } from "zod";

/** The tab last opened on each machine, per account, so a launch reopens it. */
export const LAST_TARGETS_KEY = "last-target.v1";
/** Enough for every machine someone switches between; the oldest is forgotten first. */
const LIMIT = 20;

const StoredSchema = z.record(z.string(), MobileTargetSchema);
export type LastTargets = z.infer<typeof StoredSchema>;

export function lastTargetKey(account: string, machineId: string) {
  return `${account}:${machineId}`;
}

export function parseLastTargets(raw: string | null): LastTargets {
  if (!raw) return {};
  try {
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Records `target` as the newest entry for `key`, keeping at most LIMIT machines. */
export function rememberTarget(
  targets: LastTargets,
  key: string,
  target: MobileTarget,
): LastTargets {
  const entries = Object.entries(targets).filter(([existing]) => existing !== key);
  entries.push([
    key,
    {
      ...(target.projectId ? { projectId: target.projectId } : {}),
      ...(target.tabId ? { tabId: target.tabId } : {}),
      ...(target.paneId ? { paneId: target.paneId } : {}),
    },
  ]);
  return Object.fromEntries(entries.slice(-LIMIT));
}
