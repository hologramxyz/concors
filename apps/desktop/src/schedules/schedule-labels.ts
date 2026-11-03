import type { ScheduleCadence, ScheduleRun } from "@concors/protocol";
export const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clockFormat = { hour: "numeric", minute: "2-digit" } as const;
/** A wall-clock "HH:MM" in the format `dateLabel` uses. UTC only keeps the hour from shifting. */
export function timeLabel(time: string): string {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(undefined, {
    ...clockFormat,
    timeZone: "UTC",
  });
}
const bareMarker = (text: string) => text.replace(/[\d:\s.]/g, "").toLowerCase();
/** This locale's own word for the half of the day `hour` is in, for times typed its way. */
function dayPeriod(hour: number): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  }).formatToParts(Date.UTC(2000, 0, 1, hour));
  return bareMarker(parts.find((part) => part.type === "dayPeriod")?.value ?? "");
}
/** A typed time as "HH:MM", or null. Takes "9:00 AM", "9am", "9.30 pm", "21:00" and "9". */
export function parseTime(text: string): string | null {
  const match = /^\D*(\d{1,2})(?:[:.](\d{2}))?\D*$/.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0),
    marker = bareMarker(text);
  if (marker) {
    const pm = ["p", "pm", dayPeriod(12)].includes(marker);
    if ((!pm && !["a", "am", dayPeriod(0)].includes(marker)) || hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function daysLabel(selected: number[]): string {
  const sorted = [...new Set(selected)].sort();
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "0,6") return "Weekends";
  return sorted.map((d) => days[d]).join(", ");
}
export function cadenceLabel(cadence: ScheduleCadence): string {
  if (cadence.kind === "interval")
    return cadence.minutes % 60 === 0
      ? `Every ${cadence.minutes / 60} hour${cadence.minutes === 60 ? "" : "s"}`
      : `Every ${cadence.minutes} minutes`;
  return `${cadence.kind === "daily" ? "Daily" : daysLabel(cadence.days)} at ${timeLabel(cadence.time)}`;
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
    ...clockFormat,
  });
