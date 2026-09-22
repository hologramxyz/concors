import { expect, it } from "vitest";
import { AgentPlanUsageSchema, unsupportedPlanUsage } from "./agent-usage.ts";
import { AgentResultSchema } from "./agents.ts";
import { parseClientMessage, parseDaemonMessage } from "./messages.ts";
import { ProviderResultSchema } from "./providers.ts";

const id = "11111111-1111-4111-8111-111111111111";

/** The lightest reply the daemon can give for a usage request: the session, no history. */
const conversation = {
  agent: {
    id,
    projectId: id,
    paneId: id,
    provider: "claude",
    engine: "claude",
    model: null,
    name: "Session",
    title: "Session",
    directory: "/repo",
    startedAt: "2026-09-20T10:00:00Z",
    turnStartedAt: null,
    pending: [],
    threadId: null,
    turnId: null,
    status: "idle",
    error: null,
    revision: 1,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-20T10:00:00Z",
  },
  items: [],
  hasMore: false,
};

const usage = {
  provider: "claude",
  status: "available",
  planLabel: "Max 20x",
  message: null,
  windows: [
    { id: "five-hour", label: "Session", usedPercent: 42, resetsAt: "2026-09-20T18:00:00Z" },
    { id: "weekly", label: "Weekly", usedPercent: 13.5, resetsAt: "2026-09-24T18:00:00Z" },
    { id: "weekly-fable", label: "Weekly · Fable", usedPercent: 0, resetsAt: null },
  ],
  fetchedAt: 1,
};

it("carries plan windows from the machine to its clients", () => {
  expect(
    parseClientMessage({
      type: "agent.request",
      requestId: id,
      operation: { kind: "usage", sessionId: id },
    }).success,
  ).toBe(true);
  const outcome = AgentResultSchema.shape.outcome.options[0];
  expect(outcome.safeParse({ status: "ok", conversation, usage }).success).toBe(true);
  expect(
    parseDaemonMessage({
      type: "agent.result",
      requestId: id,
      outcome: { status: "ok", conversation, usage },
    }).success,
  ).toBe(true);
});

it("carries a saved subscription's plan windows without an open chat", () => {
  expect(
    parseClientMessage({
      type: "provider.request",
      requestId: id,
      operation: { kind: "usage", id: "claude-work" },
    }).success,
  ).toBe(true);
  expect(
    ProviderResultSchema.safeParse({
      type: "provider.result",
      requestId: id,
      outcome: { status: "ok", revision: 1, providers: [], usage },
    }).success,
  ).toBe(true);
});

it("keeps windows to what a provider can actually say", () => {
  const parse = (windows: unknown[]) =>
    AgentPlanUsageSchema.safeParse({ ...usage, windows }).success;
  // A window without a figure or a reset is still a window worth showing.
  expect(parse([{ id: "weekly", label: "Weekly", usedPercent: null, resetsAt: null }])).toBe(true);
  expect(parse([{ id: "weekly", label: "Weekly", usedPercent: 120, resetsAt: null }])).toBe(false);
  expect(parse([{ id: "weekly", label: "Weekly", usedPercent: -1, resetsAt: null }])).toBe(false);
  expect(parse([{ id: "", label: "Weekly", usedPercent: 1, resetsAt: null }])).toBe(false);
  expect(parse(Array.from({ length: 13 }, () => usage.windows[0]))).toBe(false);
});

it("says an API key account has nothing to report rather than failing", () => {
  const none = unsupportedPlanUsage("claude", "Plan limits apply to subscriptions.");
  expect(AgentPlanUsageSchema.safeParse(none).success).toBe(true);
  expect(none).toMatchObject({ status: "unsupported", windows: [], planLabel: null });
});
