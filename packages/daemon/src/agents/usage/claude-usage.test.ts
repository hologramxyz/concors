import { expect, it } from "vitest";
import { AgentPlanUsageSchema } from "@concors/protocol";
import { readClaudePlanUsage } from "./claude-usage.ts";

const now = Date.parse("2026-09-20T12:00:00Z");
const reply = (limits: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: limits,
  ...rest,
});
const labels = (body: unknown) => readClaudePlanUsage(body, now).windows.map((w) => w.label);

it("reads the session, weekly and model weekly windows a subscription reports", () => {
  const usage = readClaudePlanUsage(
    reply({
      five_hour: { utilization: 42.4, resets_at: "2026-09-20T17:00:00Z" },
      seven_day: { utilization: 13, resets_at: "2026-09-24T17:00:00Z" },
      model_scoped: [{ display_name: "Fable", utilization: 91, resets_at: null }],
    }),
    now,
  );
  expect(AgentPlanUsageSchema.safeParse(usage).success).toBe(true);
  expect(usage).toMatchObject({ provider: "claude", status: "available", planLabel: "Max" });
  expect(usage.windows).toEqual([
    {
      id: "five-hour",
      label: "Session",
      usedPercent: 42.4,
      resetsAt: "2026-09-20T17:00:00.000Z",
    },
    { id: "weekly", label: "Weekly", usedPercent: 13, resetsAt: "2026-09-24T17:00:00.000Z" },
    { id: "weekly-fable", label: "Weekly · Fable", usedPercent: 91, resetsAt: null },
  ]);
});

it("shows a model's weekly window once while Anthropic reports it two ways", () => {
  const both = reply({
    seven_day_opus: { utilization: 5, resets_at: null },
    seven_day_sonnet: { utilization: 7, resets_at: null },
    model_scoped: [{ display_name: "Opus", utilization: 9, resets_at: null }],
  });
  expect(labels(both)).toEqual(["Weekly · Opus", "Weekly · Sonnet"]);
  // The server's own label wins, so a renamed bucket never appears twice.
  expect(readClaudePlanUsage(both, now).windows[0]?.usedPercent).toBe(9);
  expect(labels(reply({ seven_day_opus: { utilization: 5, resets_at: null } }))).toEqual([
    "Weekly · Opus",
  ]);
});

it("reports accounts without plan limits instead of failing", () => {
  const apiKey = readClaudePlanUsage(
    { subscription_type: null, rate_limits_available: false, rate_limits: null },
    now,
  );
  expect(apiKey).toMatchObject({ status: "unsupported", windows: [], planLabel: null });
  expect(apiKey.message).toContain("subscriptions");
  expect(readClaudePlanUsage({ rate_limits_available: true }, now).status).toBe("unsupported");
  expect(readClaudePlanUsage("nonsense", now).status).toBe("unsupported");
});

it("keeps unusable figures out of the bars", () => {
  const usage = readClaudePlanUsage(
    reply({
      five_hour: { utilization: null, resets_at: "not a date" },
      seven_day: { utilization: 140, resets_at: null },
      model_scoped: [{ display_name: "   ", utilization: 5, resets_at: null }],
    }),
    now,
  );
  expect(usage.windows).toEqual([
    { id: "five-hour", label: "Session", usedPercent: null, resetsAt: null },
    { id: "weekly", label: "Weekly", usedPercent: 100, resetsAt: null },
  ]);
  expect(AgentPlanUsageSchema.safeParse(usage).success).toBe(true);
});
