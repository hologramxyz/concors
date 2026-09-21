import { expect, it } from "vitest";
import { NativeUsageSchema } from "@concors/client-core";
import { AgentControlsSchema } from "@concors/protocol";
import { contextWindow, usageSummary, usageView } from "./context-window";

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
const answered = { usage: plan, loading: false, error: null, receivedAt: now };
const idle = { usage: null, loading: false, error: null, receivedAt: null };

it("words context and plan usage once for the popover and the phone's native sheet", () => {
  const view = usageView(
    { ...agent, context: { used: 120_000, limit: 200_000, total: 1_500_000 } },
    { supported: true, state: answered },
    now,
  );
  expect(view).toEqual({
    context: {
      summary: "120k / 200k tokens · 60% used",
      detail: "2m cumulative tokens",
      percent: 60,
      tone: "ok",
    },
    plan: {
      label: "Max",
      loading: false,
      error: null,
      message: null,
      windows: [
        {
          id: "five-hour",
          label: "Session",
          summary: "42% · resets in 2h",
          percent: 42,
          tone: "ok",
        },
        {
          id: "weekly-fable",
          label: "Weekly · Fable",
          summary: "91%",
          percent: 91,
          tone: "danger",
        },
      ],
    },
  });
  // Whatever the view says must also fit through the native bridge.
  expect(NativeUsageSchema.safeParse(view).success).toBe(true);
});

it("says why there are no bars instead of showing an empty plan", () => {
  const withoutContext = { ...agent, context: null };
  // Opening the sheet is what asks, so an unanswered plan is being read, not unsupported.
  expect(usageView(withoutContext, { supported: true, state: idle }, now)?.plan?.message).toBe(
    "Reading plan usage…",
  );
  const empty = { ...answered, usage: { ...plan, windows: [] } };
  expect(usageView(withoutContext, { supported: true, state: empty }, now)?.plan?.message).toBe(
    "This provider does not report plan limits.",
  );
  const apiKey = {
    ...answered,
    usage: {
      ...plan,
      status: "unsupported" as const,
      windows: [],
      message: "Plan limits apply to subscriptions.",
    },
  };
  expect(usageView(withoutContext, { supported: true, state: apiKey }, now)).toMatchObject({
    context: { summary: "Usage will appear after the agent reports it.", percent: null },
    plan: { message: "Plan limits apply to subscriptions.", windows: [] },
  });
  // A failure is the message; an earlier answer's bars stay beside it.
  const failed = usageView(
    agent,
    { supported: true, state: { ...answered, error: "x".repeat(600) } },
    now,
  );
  expect(failed?.plan).toMatchObject({ message: null, windows: [{}, {}] });
  expect(failed?.plan?.error).toHaveLength(500);
  expect(NativeUsageSchema.safeParse(failed).success).toBe(true);
});

it("shows nothing for a provider that reports neither context nor plan usage", () => {
  const silent = { ...agent, context: null, controls: AgentControlsSchema.parse({}) };
  expect(usageView(silent, { supported: false, state: idle }, now)).toBeNull();
  // A machine that reports plan usage still has a sheet to open, without a plan section otherwise.
  expect(usageView(silent, { supported: true, state: idle }, now)?.context.summary).toBe(
    "This provider does not report context usage.",
  );
  expect(usageView(agent, { supported: false, state: idle }, now)?.plan).toBeNull();
});

it("colors the context like the bars: amber from 70%, red from 90%", () => {
  const at = (used: number) =>
    usageView(
      { ...agent, context: { used, limit: 100, total: null } },
      { supported: false, state: idle },
      now,
    )?.context.tone;
  expect([at(69), at(70), at(89), at(90)]).toEqual(["ok", "warning", "warning", "danger"]);
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
