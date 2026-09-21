import type { AgentUsageWindow } from "@concors/protocol";

/** How a bar reads: the share used, and how long until the window rolls over. */
export type UsageTone = "ok" | "warning" | "danger";

export function usageTone(usedPercent: number | null): UsageTone | null {
  if (usedPercent === null) return null;
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 70) return "warning";
  return "ok";
}

/** Whole percents below 100, so a nearly full window never reads as an empty one. */
export function percentLabel(usedPercent: number | null): string {
  if (usedPercent === null) return "—";
  if (usedPercent > 0 && usedPercent < 1) return "<1%";
  if (usedPercent > 99 && usedPercent < 100) return ">99%";
  return `${Math.round(usedPercent)}%`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Two units at most: "resets in 2h 14m", "resets in 3d 4h", "resets in 12m". A window whose
 * reset has passed is rolling over now; one without a reset says nothing at all.
 */
export function resetLabel(resetsAt: string | null, now = Date.now()): string | null {
  if (!resetsAt) return null;
  const time = Date.parse(resetsAt);
  if (Number.isNaN(time)) return null;
  const left = time - now;
  if (left <= 0) return "resetting now";
  if (left < HOUR) return `resets in ${Math.max(1, Math.round(left / MINUTE))}m`;
  const [unit, next, size] =
    left < DAY ? ([HOUR, MINUTE, "h"] as const) : ([DAY, HOUR, "d"] as const);
  const whole = Math.floor(left / unit);
  const rest = Math.floor((left - whole * unit) / next);
  const smaller = size === "h" ? "m" : "h";
  return `resets in ${whole}${size}${rest ? ` ${rest}${smaller}` : ""}`;
}

/** The trailing text of a bar: "42% · resets in 2h 14m". */
export function windowSummary(window: AgentUsageWindow, now = Date.now()): string {
  const reset = resetLabel(window.resetsAt, now);
  return reset
    ? `${percentLabel(window.usedPercent)} · ${reset}`
    : percentLabel(window.usedPercent);
}
