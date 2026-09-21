import { z } from "zod";
import {
  type AgentPlanUsage,
  type AgentUsageWindow,
  unsupportedPlanUsage,
} from "@concors/protocol";

/**
 * Codex's account rate limits, as its app server reports them.
 *
 * Codex names windows by length rather than by purpose: a primary window (the rolling session
 * limit) and a secondary one (usually weekly). Labels come from the reported length so a plan
 * with different windows still reads correctly. Its rolling updates are sparse — a window that
 * is absent keeps its previous value instead of being cleared — so callers merge.
 */
const Window = z
  .object({
    usedPercent: z.number(),
    resetsAt: z.number().nullish(),
    windowDurationMins: z.number().nullish(),
  })
  .nullish();
const Snapshot = z.object({
  planType: z.string().nullish(),
  limitName: z.string().nullish(),
  primary: Window,
  secondary: Window,
});

const HOUR = 60;
const DAY = 24 * HOUR;
/** Codex reports seconds; treat anything under year-2001-in-milliseconds as seconds. */
const resets = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const ms = value < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const percent = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

export function windowLabel(minutes: number | null | undefined, fallback: string): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes >= 6 * DAY && minutes <= 8 * DAY) return "Weekly";
  if (minutes >= 27 * DAY) return "Monthly";
  if (minutes % DAY === 0) return `${minutes / DAY}-day`;
  if (minutes >= HOUR) return `${Math.round(minutes / HOUR)}-hour`;
  return `${minutes}-minute`;
}

/** Codex names plans in lower case (`pro`, `team`); people read them capitalized. */
const plan = (value: string | null | undefined) => {
  const name = value?.trim() ?? "";
  if (!name) return null;
  return name === name.toLowerCase() ? name[0]?.toUpperCase() + name.slice(1) : name;
};

export function readCodexPlanUsage(body: unknown, now = Date.now()): AgentPlanUsage {
  const parsed = Snapshot.safeParse(body);
  if (!parsed.success)
    return unsupportedPlanUsage("codex", "Codex reported limits we could not read.");
  const { primary, secondary } = parsed.data;
  if (!primary && !secondary)
    return {
      ...unsupportedPlanUsage("codex", "This Codex account reports no plan limits."),
      fetchedAt: now,
    };
  const windows: AgentUsageWindow[] = [];
  const add = (id: string, fallback: string, window: z.infer<typeof Window>) => {
    if (!window) return;
    windows.push({
      id,
      label: windowLabel(window.windowDurationMins, fallback),
      usedPercent: percent(window.usedPercent),
      resetsAt: resets(window.resetsAt),
    });
  };
  add("primary", "Session", primary);
  add("secondary", "Weekly", secondary);
  return {
    provider: "codex",
    status: "available",
    planLabel: plan(parsed.data.planType) ?? plan(parsed.data.limitName),
    message: null,
    windows,
    fetchedAt: now,
  };
}
