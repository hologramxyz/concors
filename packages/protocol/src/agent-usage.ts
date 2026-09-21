import { z } from "zod";

/**
 * What a provider says is left of the plan behind an agent: the rolling windows coding
 * subscriptions are limited by (a five-hour session window, a weekly one, sometimes a weekly
 * window for one model) as percentages with their reset times.
 *
 * Deliberately provider-agnostic: a window is a label, a percentage and a reset, so a new
 * provider is a mapping in its adapter and no UI change. Percentages are what providers report;
 * neither token counts nor prices are implied. Context window usage is separate and per session
 * (`AgentInfo.context`), because it describes one conversation rather than an account.
 */
export const AGENT_USAGE_CAPABILITY = "agent-plan-usage";
/** Windows are asked for, not pushed; this is how long a client may reuse an answer. */
export const AGENT_USAGE_TTL_MS = 60_000;

export const AgentUsageWindowSchema = z.object({
  /** Stable across refreshes so a bar keeps its place: `five-hour`, `weekly`, `weekly-opus`. */
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  /** 0–100 as the provider reports it, or null when it reports a window without a figure. */
  usedPercent: z.number().min(0).max(100).nullable(),
  /** ISO 8601, or null when the provider does not say when the window rolls over. */
  resetsAt: z.string().max(40).nullable(),
});
export type AgentUsageWindow = z.infer<typeof AgentUsageWindowSchema>;

export const AgentPlanUsageSchema = z.object({
  /** The provider engine the windows belong to, so a listing is never shown for another. */
  provider: z.string().max(40),
  /**
   * - `available`: `windows` describes the plan, even if empty.
   * - `unsupported`: this provider or this kind of account (an API key, a self-hosted model)
   *   has no plan windows to report. Not an error.
   * - `signed-out`: the provider needs signing in before it can say.
   * - `error`: asking failed; `message` says why.
   */
  status: z.enum(["available", "unsupported", "signed-out", "error"]),
  /** The plan as the provider names it: `Max 20x`, `Plus`, `Team`. */
  planLabel: z.string().max(80).nullable(),
  message: z.string().max(500).nullable(),
  windows: z.array(AgentUsageWindowSchema).max(12),
  /** When the daemon asked the provider, so clients can show how fresh this is. */
  fetchedAt: z.number().int().nonnegative(),
});
export type AgentPlanUsage = z.infer<typeof AgentPlanUsageSchema>;

export const unsupportedPlanUsage = (provider: string, message: string | null = null) =>
  ({
    provider,
    status: "unsupported",
    planLabel: null,
    message,
    windows: [],
    fetchedAt: Date.now(),
  }) satisfies AgentPlanUsage;
