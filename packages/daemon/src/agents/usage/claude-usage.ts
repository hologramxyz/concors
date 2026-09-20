import { z } from "zod";
import {
  type AgentPlanUsage,
  type AgentUsageWindow,
  unsupportedPlanUsage,
} from "@concors/protocol";

/**
 * Claude Code's own `/usage` figures, as the Agent SDK reports them.
 *
 * Anthropic describes model-scoped weekly limits twice while they migrate: legacy
 * `seven_day_<model>` keys and a `model_scoped` array carrying the server's own label (`Fable`).
 * The array wins where both describe the same model, so a renamed bucket never shows twice.
 * Accounts without plan limits (API keys, Bedrock, Vertex) report that rather than an error.
 */
const Window = z
  .object({ utilization: z.number().nullish(), resets_at: z.string().nullish() })
  .nullish();
const Usage = z.object({
  subscription_type: z.string().nullish(),
  rate_limits_available: z.boolean().nullish(),
  rate_limits: z
    .object({
      five_hour: Window,
      seven_day: Window,
      seven_day_oauth_apps: Window,
      seven_day_opus: Window,
      seven_day_sonnet: Window,
      model_scoped: z
        .array(
          z.object({
            display_name: z.string(),
            utilization: z.number().nullish(),
            resets_at: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const API_KEY_ACCOUNT = "Plan limits apply to Claude subscriptions; this session does not use one.";
const plans: Record<string, string> = {
  pro: "Pro",
  max: "Max",
  team: "Team",
  enterprise: "Enterprise",
};
const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");
const percent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
const resets = (value: string | null | undefined) => {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

export function readClaudePlanUsage(body: unknown, now = Date.now()): AgentPlanUsage {
  const parsed = Usage.safeParse(body);
  if (!parsed.success)
    return unsupportedPlanUsage("claude", "Claude reported usage we could not read.");
  const { rate_limits: limits, rate_limits_available: available } = parsed.data;
  if (available === false || !limits)
    return { ...unsupportedPlanUsage("claude", API_KEY_ACCOUNT), fetchedAt: now };
  const windows: AgentUsageWindow[] = [];
  const add = (id: string, label: string, window: z.infer<typeof Window>) => {
    if (!window) return;
    windows.push({
      id,
      label,
      usedPercent: percent(window.utilization),
      resetsAt: resets(window.resets_at),
    });
  };
  add("five-hour", "Session", limits.five_hour);
  add("weekly", "Weekly", limits.seven_day);
  const scoped = new Set<string>();
  for (const model of limits.model_scoped ?? []) {
    const name = model.display_name.trim();
    if (!name || scoped.has(key(name))) continue;
    scoped.add(key(name));
    windows.push({
      id: `weekly-${key(name)}`,
      label: `Weekly · ${name}`,
      usedPercent: percent(model.utilization),
      resetsAt: resets(model.resets_at),
    });
  }
  // The legacy keys describe the same weekly buckets; keep them only when unnamed above.
  if (!scoped.has("opus")) add("weekly-opus", "Weekly · Opus", limits.seven_day_opus);
  if (!scoped.has("sonnet")) add("weekly-sonnet", "Weekly · Sonnet", limits.seven_day_sonnet);
  add("weekly-apps", "Weekly · Apps", limits.seven_day_oauth_apps);
  const subscription = parsed.data.subscription_type?.trim().toLowerCase() ?? "";
  return {
    provider: "claude",
    status: "available",
    planLabel: plans[subscription] ?? (subscription ? subscription : null),
    message: null,
    windows: windows.slice(0, 12),
    fetchedAt: now,
  };
}
