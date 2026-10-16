import { useEffect, useLayoutEffect, useMemo, useState } from "react";

/**
 * Projects left behind stay mounted so switching back to one is instant, but each keeps its
 * terminals connected and its chats updating. Like Paseo, keep only the most recent few, and let
 * one hidden for a while go; it loads again the ordinary way when it is next opened.
 */
export const MAX_RETAINED_PROJECTS = 10;
export const RETAINED_PROJECT_TTL_MS = 10 * 60 * 1000;

export interface RetainedProject {
  id: string;
  /** When it was last left; null while it is the one shown. */
  inactiveSince: number | null;
}

/** The selected project first, then the most recently left ones that have not expired. */
export function retainProjects(
  current: readonly RetainedProject[],
  active: string | null,
  existing: ReadonlySet<string>,
  now: number,
  limit = MAX_RETAINED_PROJECTS,
  ttl = RETAINED_PROJECT_TTL_MS,
): readonly RetainedProject[] {
  const next: RetainedProject[] = [];
  if (active !== null && existing.has(active)) next.push({ id: active, inactiveSince: null });
  for (const entry of current) {
    if (next.length >= limit) break;
    if (entry.id === active || !existing.has(entry.id)) continue;
    const inactiveSince = entry.inactiveSince ?? now;
    if (now - inactiveSince < ttl) next.push({ id: entry.id, inactiveSince });
  }
  const same =
    next.length === current.length &&
    next.every(
      (entry, index) =>
        entry.id === current[index]?.id && entry.inactiveSince === current[index]?.inactiveSince,
    );
  return same ? current : next;
}

/** How long until the next hidden project expires, or null when none will. */
export function nextExpiry(
  entries: readonly RetainedProject[],
  now: number,
  ttl = RETAINED_PROJECT_TTL_MS,
): number | null {
  let delay: number | null = null;
  for (const { inactiveSince } of entries)
    if (inactiveSince !== null) {
      const left = Math.max(0, inactiveSince + ttl - now);
      delay = delay === null ? left : Math.min(delay, left);
    }
  return delay;
}

/** The projects whose visited tabs stay mounted: the selected one and the recent others. */
export function useRetainedProjects(
  active: string | null,
  projectIds: readonly string[],
): ReadonlySet<string> {
  const key = projectIds.join("\n");
  const existing = useMemo(() => new Set(key ? key.split("\n") : []), [key]);
  const [entries, setEntries] = useState<readonly RetainedProject[]>([]);
  // Settled before paint, and the selected project counts from the first render, so switching
  // never unmounts and remounts a project that stays. An effect because it reads the clock.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries((current) => retainProjects(current, active, existing, Date.now()));
  }, [active, existing]);
  useEffect(() => {
    const delay = nextExpiry(entries, Date.now());
    if (delay === null) return;
    const timer = setTimeout(
      () => setEntries((current) => retainProjects(current, active, existing, Date.now())),
      delay + 1,
    );
    return () => clearTimeout(timer);
  }, [entries, active, existing]);
  return useMemo(
    () => new Set([...(active === null ? [] : [active]), ...entries.map((entry) => entry.id)]),
    [active, entries],
  );
}
