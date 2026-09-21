import { findAgentModel, type AgentInfo, type AgentPlanUsage } from "@concors/protocol";
import { windowSummary } from "./usage-labels";

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
