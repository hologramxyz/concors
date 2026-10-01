import { expect, it } from "vitest";
import {
  currentWindow,
  hasReset,
  percentLabel,
  resetLabel,
  usageTone,
  windowSummary,
} from "./usage-labels";

const now = Date.parse("2026-09-20T12:00:00Z");
const at = (ms: number) => new Date(now + ms).toISOString();

it("warns as a window fills up", () => {
  expect([0, 69.9, 70, 89.9, 90, 100].map(usageTone)).toEqual([
    "ok",
    "ok",
    "warning",
    "warning",
    "danger",
    "danger",
  ]);
  expect(usageTone(null)).toBeNull();
});

it("rounds percentages without hiding a nearly full or barely used window", () => {
  expect(percentLabel(0)).toBe("0%");
  expect(percentLabel(0.4)).toBe("<1%");
  expect(percentLabel(42.4)).toBe("42%");
  expect(percentLabel(99.6)).toBe(">99%");
  expect(percentLabel(100)).toBe("100%");
  expect(percentLabel(null)).toBe("—");
});

it("counts down to a reset in at most two units", () => {
  expect(resetLabel(at(12 * 60_000), now)).toBe("resets in 12m");
  expect(resetLabel(at(2 * 3_600_000 + 14 * 60_000), now)).toBe("resets in 2h 14m");
  expect(resetLabel(at(5 * 3_600_000), now)).toBe("resets in 5h");
  expect(resetLabel(at(3 * 86_400_000 + 4 * 3_600_000), now)).toBe("resets in 3d 4h");
  expect(resetLabel(at(30_000), now)).toBe("resets in 1m");
  expect(resetLabel(at(-60_000), now)).toBe("resetting now");
  expect(resetLabel(null, now)).toBeNull();
  expect(resetLabel("not a date", now)).toBeNull();
});

it("puts a window's share and its reset in one line", () => {
  const window = { id: "five-hour", label: "Session", usedPercent: 42, resetsAt: at(3_600_000) };
  expect(windowSummary(window, now)).toBe("42% · resets in 1h");
  expect(windowSummary({ ...window, resetsAt: null }, now)).toBe("42%");
  expect(windowSummary({ ...window, usedPercent: null, resetsAt: null }, now)).toBe("—");
});

it("stops showing a window's figure once it has rolled over", () => {
  const window = { id: "five-hour", label: "Session", usedPercent: 92, resetsAt: at(-60_000) };
  expect(hasReset(window, now)).toBe(true);
  // The 92% belongs to the window that ended; the new one is unknown until asked again.
  expect(windowSummary(currentWindow(window, now), now)).toBe("— · resetting now");
  const running = { ...window, resetsAt: at(60_000) };
  expect(hasReset(running, now)).toBe(false);
  expect(currentWindow(running, now)).toBe(running);
  expect(hasReset({ ...window, resetsAt: null }, now)).toBe(false);
});
