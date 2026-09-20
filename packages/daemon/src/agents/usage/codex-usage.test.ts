import { expect, it } from "vitest";
import { AgentPlanUsageSchema } from "@concors/protocol";
import { readCodexPlanUsage, windowLabel } from "./codex-usage.ts";

const now = Date.parse("2026-09-20T12:00:00Z");
const resetsAt = Math.floor(Date.parse("2026-09-20T17:00:00Z") / 1000);

it("reads the windows Codex reports and names them by their length", () => {
  const usage = readCodexPlanUsage(
    {
      planType: "pro",
      limitName: "ChatGPT Pro",
      primary: { usedPercent: 42, resetsAt, windowDurationMins: 300 },
      secondary: { usedPercent: 8, resetsAt: null, windowDurationMins: 10080 },
    },
    now,
  );
  expect(AgentPlanUsageSchema.safeParse(usage).success).toBe(true);
  expect(usage).toMatchObject({ provider: "codex", status: "available", planLabel: "Pro" });
  expect(usage.windows).toEqual([
    { id: "primary", label: "5-hour", usedPercent: 42, resetsAt: "2026-09-20T17:00:00.000Z" },
    { id: "secondary", label: "Weekly", usedPercent: 8, resetsAt: null },
  ]);
});

it("names windows Codex describes only by length", () => {
  expect(windowLabel(300, "Session")).toBe("5-hour");
  expect(windowLabel(10080, "Weekly")).toBe("Weekly");
  expect(windowLabel(43200, "Weekly")).toBe("Monthly");
  expect(windowLabel(2880, "Session")).toBe("2-day");
  expect(windowLabel(30, "Session")).toBe("30-minute");
  expect(windowLabel(null, "Session")).toBe("Session");
});

it("accepts reset times in seconds or milliseconds", () => {
  const ms = readCodexPlanUsage({ primary: { usedPercent: 1, resetsAt: resetsAt * 1000 } }, now);
  expect(ms.windows[0]?.resetsAt).toBe("2026-09-20T17:00:00.000Z");
  const missing = readCodexPlanUsage({ primary: { usedPercent: 1, resetsAt: 0 } }, now);
  expect(missing.windows[0]?.resetsAt).toBeNull();
});

it("reports an account with no windows instead of empty bars", () => {
  expect(readCodexPlanUsage({ planType: "pro" }, now)).toMatchObject({
    status: "unsupported",
    windows: [],
  });
  expect(readCodexPlanUsage(null, now).status).toBe("unsupported");
  expect(readCodexPlanUsage({ primary: { usedPercent: "lots" } }, now).status).toBe("unsupported");
});
