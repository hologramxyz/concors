import { describe, it, expect } from "vitest";
import { nextRun } from "./cadence.ts";

describe("schedule cadence", () => {
  it("advances an interval without replaying missed ticks", () => {
    expect(nextRun({ kind: "interval", minutes: 60 }, new Date("2026-09-16T10:23:45Z"))).toBe(
      "2026-09-16T11:23:45.000Z",
    );
  });
  it("honors wall-clock time and weekday in the selected zone", () => {
    expect(
      nextRun(
        { kind: "weekly", days: [1], time: "09:00", timezone: "America/Los_Angeles" },
        new Date("2026-09-16T10:00:00Z"),
      ),
    ).toBe("2026-09-21T16:00:00.000Z");
  });
  it("skips a nonexistent spring-forward time", () => {
    expect(
      nextRun(
        { kind: "daily", time: "02:30", timezone: "America/New_York" },
        new Date("2026-03-08T05:00:00Z"),
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
  });
  it("does not repeat a daily run when the clock falls back", () => {
    expect(
      nextRun(
        { kind: "daily", time: "01:30", timezone: "America/New_York" },
        new Date("2026-11-01T05:30:00Z"),
      ),
    ).toBe("2026-11-02T06:30:00.000Z");
  });
});
