import type { ScheduleCadence, ScheduleRun } from "@concors/protocol";
export const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function cadenceLabel(cadence: ScheduleCadence): string {
  if (cadence.kind === "interval")
    return cadence.minutes % 60 === 0
      ? `Every ${cadence.minutes / 60} hour${cadence.minutes === 60 ? "" : "s"}`
      : `Every ${cadence.minutes} minutes`;
  return `${
    cadence.kind === "daily"
      ? "Daily"
      : [...new Set(cadence.days)]
          .sort()
          .map((d) => days[d])
          .join(", ")
  } at ${cadence.time} · ${cadence.timezone}`;
}
export const runLabel: Record<ScheduleRun["status"], string> = {
  running: "Working",
  needs_input: "Needs input",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  interrupted: "Interrupted",
};
export const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
