import { expect, it } from "vitest";
import { contextWindow, usageSummary } from "./context-window";

const model = {
  id: "claude-opus-5",
  label: "Opus 5",
  efforts: [],
  defaultEffort: null,
  contextWindow: 1_000_000,
};
const agent = {
  context: { used: 120_000, limit: 200_000, total: null },
  model: "claude-opus-5",
  models: [model],
};

it("prefers the window the provider reported for this turn", () => {
  expect(contextWindow(agent)).toEqual({ used: 120_000, limit: 200_000, percent: 60 });
});

it("falls back to the model catalog so the ring fills before the first turn ends", () => {
  expect(contextWindow({ ...agent, context: { used: 250_000, limit: null, total: null } })).toEqual(
    { used: 250_000, limit: 1_000_000, percent: 25 },
  );
  // A model the catalog does not describe leaves the ring empty rather than guessing.
  expect(
    contextWindow({
      ...agent,
      model: "something-else",
      context: { used: 5, limit: null, total: null },
    }),
  ).toBeNull();
  expect(
    contextWindow({ ...agent, models: [], context: { used: 5, limit: null, total: null } }),
  ).toBeNull();
});

it("has nothing to show until a provider reports usage", () => {
  expect(contextWindow({ ...agent, context: null })).toBeNull();
  expect(contextWindow({ ...agent, context: undefined })).toBeNull();
});

it("never reports more than a full window", () => {
  expect(
    contextWindow({ ...agent, context: { used: 300_000, limit: 200_000, total: null } })?.percent,
  ).toBe(100);
});

it("summarizes context and plan usage as text for the phone's native sheet", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  const plan = {
    provider: "claude",
    status: "available" as const,
    planLabel: "Max",
    message: null,
    windows: [
      {
        id: "five-hour",
        label: "Session",
        usedPercent: 42,
        resetsAt: new Date(now + 2 * 3_600_000).toISOString(),
      },
      { id: "weekly-fable", label: "Weekly · Fable", usedPercent: 91, resetsAt: null },
    ],
    fetchedAt: now,
  };
  const text = usageSummary(agent, plan, now);
  expect(text.split("\n")).toEqual([
    `${(120_000).toLocaleString()} / ${(200_000).toLocaleString()} tokens · 60% used`,
    "",
    "Plan usage · Max",
    "Session: 42% · resets in 2h",
    "Weekly · Fable: 91%",
  ]);
  expect(
    usageSummary(
      { ...agent, context: null },
      {
        ...plan,
        status: "unsupported",
        windows: [],
        message: "Plan limits apply to subscriptions.",
      },
      now,
    ),
  ).toBe("Usage will appear after the agent reports it.\n\nPlan limits apply to subscriptions.");
  const many = {
    ...plan,
    windows: Array.from({ length: 12 }, (_, i) => ({
      ...plan.windows[1]!,
      id: `w${i}`,
      label: "x".repeat(80),
    })),
  };
  expect(usageSummary(agent, many, now).length).toBeLessThanOrEqual(1000);
});
