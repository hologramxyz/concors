import { expect, it } from "vitest";
import { cadenceLabel, parseTime, timeLabel } from "./schedule-labels";

const weekly = (days: number[]) =>
  cadenceLabel({ kind: "weekly", time: "09:00", timezone: "UTC", days });

it("names the two common sets of days, in any order, and lists the rest", () => {
  const at = `at ${timeLabel("09:00")}`;
  expect(weekly([5, 4, 3, 2, 1])).toBe(`Weekdays ${at}`);
  expect(weekly([6, 0])).toBe(`Weekends ${at}`);
  expect(weekly([1, 3])).toBe(`Mon, Wed ${at}`);
  expect(weekly([1, 2, 3, 4])).toBe(`Mon, Tue, Wed, Thu ${at}`);
});

it("leaves the time zone out of the cadence, which the card shows on its own", () => {
  expect(cadenceLabel({ kind: "daily", time: "09:00", timezone: "America/Halifax" })).toBe(
    `Daily at ${timeLabel("09:00")}`,
  );
});

it("reads typed times", () => {
  for (const [text, time] of [
    ["9:00 AM", "09:00"],
    ["9am", "09:00"],
    ["9:30 p.m.", "21:30"],
    ["5:30pm", "17:30"],
    ["12 AM", "00:00"],
    ["12:15 PM", "12:15"],
    ["21:00", "21:00"],
    ["00:05", "00:05"],
    ["9", "09:00"],
  ] as const)
    expect(parseTime(text), text).toBe(time);
});

it("turns down what is not a time", () => {
  for (const text of ["", "soon", "24:00", "9:60", "13 PM", "0 AM", "9 xm", "1:2:3"])
    expect(parseTime(text), text).toBeNull();
});

it("reads back every time it writes, whatever the locale's clock", () => {
  for (const time of ["00:00", "09:05", "12:00", "17:30", "23:59"])
    expect(parseTime(timeLabel(time))).toBe(time);
});
