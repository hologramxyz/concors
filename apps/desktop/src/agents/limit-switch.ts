import type { AgentPlanUsage, ProviderStatus } from "@concors/protocol";
import { currentWindow, percentLabel, resetLabel } from "./usage-labels";

/**
 * What a chat offers when its account reaches a plan limit: the machine's other accounts for the
 * same engine. Switching is the machine-wide choice Settings makes (see
 * docs/agent-subscriptions.md), offered where the limit is felt instead of three screens away.
 */

/**
 * The accounts this engine could switch to: every other enabled subscription, and the machine's
 * own sign-in while a subscription is the one in use.
 */
export function limitSwitchChoices(providers: ProviderStatus[], engine: string): ProviderStatus[] {
  const base = providers.find((p) => p.id === engine && p.engine === engine && !p.subscription);
  const subscriptions = providers.filter((p) => p.subscription && p.engine === engine && p.enabled);
  const inUse = subscriptions.some((p) => p.active);
  return [...subscriptions.filter((p) => !p.active), ...(inUse && base?.enabled ? [base] : [])];
}

/** The most an account has used of any window, so the roomiest account is offered first. */
export function busiestWindow(usage: AgentPlanUsage | null | undefined): number | null {
  if (usage?.status !== "available") return null;
  const used = usage.windows
    .map((w) => currentWindow(w).usedPercent)
    .flatMap((percent) => (percent === null ? [] : [percent]));
  return used.length ? Math.max(...used) : null;
}

/** The two windows nearest their limit, which is what decides whether an account has room. */
export function usageGlance(usage: AgentPlanUsage | null | undefined): string | null {
  if (usage?.status !== "available") return null;
  const windows = usage.windows
    .map((w) => currentWindow(w))
    .filter((w) => w.usedPercent !== null)
    .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))
    .slice(0, 2);
  return windows.length
    ? windows.map((w) => `${w.label} ${percentLabel(w.usedPercent)}`).join(" · ")
    : null;
}

export function limitHeadline(engine: string, resetsAt: string | null, now = Date.now()): string {
  const account =
    engine === "codex" ? "ChatGPT account" : engine === "claude" ? "Claude account" : "account";
  const reset = resetLabel(resetsAt, now);
  // A reset already passed says nothing useful here; trying again is the answer then.
  return `This ${account} reached its usage limit${reset && reset !== "resetting now" ? ` · ${reset}` : ""}`;
}
