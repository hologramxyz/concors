import { findAgentModel, type AgentInfo, type AgentPlanUsage } from "@concors/protocol";
import type { NativeUsage } from "@concors/client-core";
import { formatTokenCount } from "./paseo/context-window-meter.utils";
import type { PlanUsageState } from "./plan-usage";
import { usageTone, windowSummary } from "./usage-labels";

/**
 * How full this conversation's context window is.
 *
 * Providers report the window in two ways: with the usage of a turn, and in their model catalog.
 * The turn is authoritative — a model can run with a smaller window than its catalog entry
 * advertises — but the catalog is known before the first turn ends, so the ring fills in
 * immediately instead of waiting. Without either, there is no percentage to show.
 */
export function contextWindow(
  agent: Pick<AgentInfo, "context" | "model" | "models">,
): { used: number; limit: number; percent: number } | null {
  const used = agent.context?.used;
  if (typeof used !== "number") return null;
  const catalog = findAgentModel(agent.models ?? [], agent.model)?.contextWindow;
  const limit = agent.context?.limit ?? (typeof catalog === "number" ? catalog : null);
  if (!limit || limit <= 0) return null;
  return { used, limit, percent: Math.max(0, Math.min(100, (used / limit) * 100)) };
}

/**
 * What the context popover says, worded once so the phone's native sheet reads the same. Null
 * when the provider reports neither context nor plan usage: that is nothing to show, not an
 * empty ring.
 */
export function usageView(
  agent: Pick<AgentInfo, "context" | "controls" | "model" | "models">,
  plans: { supported: boolean; state: PlanUsageState },
  now = Date.now(),
): NativeUsage | null {
  const window = contextWindow(agent);
  const reports = agent.controls?.contextUsage ?? window !== null;
  if (!reports && !plans.supported) return null;
  const { usage, loading, error } = plans.state;
  const windows = usage?.windows ?? [];
  return {
    context: {
      summary: window
        ? `${formatTokenCount(window.used)} / ${formatTokenCount(window.limit)} tokens · ${Math.round(window.percent)}% used`
        : agent.controls?.contextUsage === false
          ? "This provider does not report context usage."
          : "Usage will appear after the agent reports it.",
      detail:
        agent.context && agent.context.total !== null
          ? `${formatTokenCount(agent.context.total)} cumulative tokens`
          : null,
      percent: window?.percent ?? null,
      tone: usageTone(window?.percent ?? null),
    },
    plan: plans.supported
      ? {
          label: usage?.planLabel ?? null,
          loading,
          // The machine's reason is shown as written, within what the native bridge carries.
          error: error?.slice(0, 500) ?? null,
          // Nothing answered yet means it is being asked: opening either surface asks.
          message:
            windows.length || error
              ? null
              : usage
                ? (usage.message ?? "This provider does not report plan limits.")
                : "Reading plan usage…",
          windows: windows.map((entry) => ({
            id: entry.id,
            label: entry.label,
            summary: windowSummary(entry, now),
            percent: entry.usedPercent,
            tone: usageTone(entry.usedPercent),
          })),
        }
      : null,
  };
}

/**
 * The same figures as one line per fact, for surfaces that can only show text — the phone's
 * native composer shows this in an alert. Bounded, because that surface carries 1,000 characters.
 */
export function usageSummary(
  agent: Pick<AgentInfo, "context" | "model" | "models">,
  plan: AgentPlanUsage | null,
  now = Date.now(),
): string {
  const window = contextWindow(agent);
  const lines = [
    window
      ? `${window.used.toLocaleString()} / ${window.limit.toLocaleString()} tokens · ${Math.round(window.percent)}% used`
      : "Usage will appear after the agent reports it.",
  ];
  if (agent.context && agent.context.total !== null)
    lines.push(`${agent.context.total.toLocaleString()} cumulative tokens`);
  if (plan?.status === "available" && plan.windows.length) {
    lines.push("", plan.planLabel ? `Plan usage · ${plan.planLabel}` : "Plan usage");
    for (const entry of plan.windows) lines.push(`${entry.label}: ${windowSummary(entry, now)}`);
  } else if (plan?.message) lines.push("", plan.message);
  return lines.join("\n").slice(0, 1000);
}
