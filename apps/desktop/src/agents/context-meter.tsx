// DOM adaptation of Paseo components/context-window-meter.tsx; Apache-2.0.
// Copyright (c) 2025-present Mohamed Boudra. See third-party/paseo-LICENSE.
import { Popover } from "radix-ui";
import { useContext } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { AgentInfo, AgentUsageWindow } from "@concors/protocol";
import { ComposerSurfaceContext } from "./composer-expansion";
import { formatTokenCount } from "./paseo/context-window-meter.utils";
import { contextWindow } from "./context-window";
import { usePlanUsage } from "./use-plan-usage";
import { usageTone, windowSummary } from "./usage-labels";

/**
 * The composer's context ring, and behind it what is left of the provider's plan.
 *
 * The ring is this conversation; the bars are the account the provider bills, which several
 * conversations share. Both are only ever what a provider reports: a provider that says nothing
 * shows nothing rather than an empty ring.
 */
export function ContextMeter({ agent }: { agent: AgentInfo }) {
  const composerSurface = useContext(ComposerSurfaceContext);
  const plans = usePlanUsage(agent.provider);
  const plan = plans.state;
  const window = contextWindow(agent);
  const reports = agent.controls?.contextUsage ?? window !== null;
  if (!reports && !plans.supported) return null;
  const percent = window?.percent ?? null;
  const refresh = (force = false) => plans.refresh(agent.id, force);
  return (
    <Popover.Root onOpenChange={(open) => open && refresh()}>
      <Popover.Trigger
        type="button"
        aria-label="Context window"
        title={percent === null ? "Context usage pending" : `${Math.round(percent)}% context used`}
        className="agent-control"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            "size-4 -rotate-90",
            percent !== null && percent > 90 && "text-destructive",
            percent !== null && percent >= 70 && percent <= 90 && "text-amber-500",
          )}
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.2"
          />
          {percent !== null && (
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={Math.PI * 12}
              strokeDashoffset={Math.PI * 12 * (1 - percent / 100)}
            />
          )}
        </svg>
        <span className="sr-only">
          {percent === null ? "Usage pending" : `${Math.round(percent)}% context`}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-composer-surface={composerSurface}
          side="top"
          sideOffset={8}
          align="end"
          className="z-50 w-80 rounded-xl border bg-popover p-4 text-sm shadow-lg"
        >
          <section aria-label="Context window">
            <p className="font-medium">Context window</p>
            <p className="mt-2 text-muted-foreground">
              {window
                ? `${formatTokenCount(window.used)} / ${formatTokenCount(window.limit)} tokens · ${Math.round(window.percent)}% used`
                : agent.controls?.contextUsage === false
                  ? "This provider does not report context usage."
                  : "Usage will appear after the agent reports it."}
            </p>
            {agent.context && agent.context.total !== null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTokenCount(agent.context.total)} cumulative tokens
              </p>
            )}
          </section>
          {plans.supported && (
            <section aria-label="Plan usage" className="mt-4 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  Plan usage
                  {plan.usage?.planLabel && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {plan.usage.planLabel}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  aria-label="Refresh plan usage"
                  title="Refresh plan usage"
                  disabled={plan.loading}
                  onClick={() => refresh(true)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className={cn("size-3.5", plan.loading && "animate-spin")} />
                </button>
              </div>
              {plan.error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {plan.error}
                </p>
              )}
              {plan.usage?.windows.length ? (
                <ul className="mt-2.5 space-y-2.5">
                  {plan.usage.windows.map((window) => (
                    <UsageBar key={window.id} window={window} />
                  ))}
                </ul>
              ) : (
                !plan.error && (
                  <p className="mt-2 text-muted-foreground">
                    {plan.loading && !plan.usage
                      ? "Reading plan usage…"
                      : (plan.usage?.message ?? "This provider does not report plan limits.")}
                  </p>
                )
              )}
            </section>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const tones = {
  ok: "bg-foreground/70",
  warning: "bg-amber-500",
  danger: "bg-destructive",
} as const;

function UsageBar({ window }: { window: AgentUsageWindow }) {
  const tone = usageTone(window.usedPercent);
  return (
    <li>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">{window.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{windowSummary(window)}</span>
      </p>
      <div
        role="progressbar"
        aria-label={window.label}
        aria-valuenow={window.usedPercent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          data-usage-tone={tone ?? "unknown"}
          className={cn("h-full rounded-full", tone ? tones[tone] : "bg-transparent")}
          style={{ width: `${Math.min(100, Math.max(0, window.usedPercent ?? 0))}%` }}
        />
      </div>
    </li>
  );
}
