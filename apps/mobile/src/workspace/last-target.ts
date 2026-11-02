import { MobileTargetSchema, type MobileTarget } from "@concors/client-core";
import { z } from "zod";

/**
 * The tab last opened on each machine, so a launch reopens it, and in each of its workspaces, so
 * going back to a workspace finds the tab it was left on. Per account, in one stored record.
 */
export const LAST_TARGETS_KEY = "last-target.v1";
/** Enough for the workspaces someone goes back to; the least recently used is forgotten first. */
const LIMIT = 40;

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

const lastWorkspaceKey = (account: string, machineId: string, projectId: string) =>
  `${lastTargetKey(account, machineId)}:${projectId}`;

/** The tab last opened in each workspace of a machine, by workspace ID. */
export function lastWorkspaceTargets(
  targets: LastTargets,
  account: string,
  machineId: string,
): LastTargets {
  const prefix = lastWorkspaceKey(account, machineId, "");
  return Object.fromEntries(
    Object.entries(targets)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, target]) => [key.slice(prefix.length), target]),
  );
}

/** Records a tab as the last opened both on its machine and in its workspace. */
export function rememberVisit(
  targets: LastTargets,
  account: string,
  machineId: string,
  target: MobileTarget,
): LastTargets {
  const visited = target.projectId
    ? rememberTarget(targets, lastWorkspaceKey(account, machineId, target.projectId), target)
    : targets;
  return rememberTarget(visited, lastTargetKey(account, machineId), target);
}

/** Records `target` as the newest entry for `key`, keeping at most LIMIT entries. */
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
