import type { ScheduleCadence } from "@concors/protocol";

/** Strictly after `after`. Calendar runs happen once per local date, including DST folds.
 * A nonexistent local time (spring forward) is skipped, rather than silently moving the run. */
export function nextRun(cadence: ScheduleCadence, after: Date): string {
  if (cadence.kind === "interval")
    return new Date(after.getTime() + cadence.minutes * 60000).toISOString();
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: cadence.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = (date: Date) =>
    Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
  const start = parts(after);
  const dateKey = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const passedToday = `${start.hour}:${start.minute}` >= cadence.time;
  // Two weeks also covers a weekly time skipped by a spring-forward transition.
  for (
    let minute = Math.floor(after.getTime() / 60000) + 1, end = minute + 15 * 1440;
    minute < end;
    minute++
  ) {
    const candidate = new Date(minute * 60000),
      p = parts(candidate);
    if (`${p.hour}:${p.minute}` !== cadence.time) continue;
    if (passedToday && dateKey(p) === dateKey(start)) continue;
    if (cadence.kind === "weekly" && !cadence.days.includes(weekdays.indexOf(p.weekday ?? "")))
      continue;
    return candidate.toISOString();
  }
  throw new Error("Could not find the next scheduled time in this time zone");
}
