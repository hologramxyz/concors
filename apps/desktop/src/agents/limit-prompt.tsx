import { PaneVisibilityContext } from "@/components/compact-layout";
import { useTabVisible } from "@/workspace/tab-visibility";
import { accountName, libraryFromProviders } from "@/settings/subscriptions";
import type { DaemonConnection } from "@concors/daemon-client";
import { useContext, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  PROVIDER_USAGE_CAPABILITY,
  SUBSCRIPTION_ENGINES,
  type AgentInfo,
  type AgentPlanUsage,
  type ProviderStatus,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { busiestWindow, limitHeadline, limitSwitchChoices, usageGlance } from "./limit-switch";
import { invalidateModelCatalogs } from "./model-catalog";

import { Button } from "@/components/ui/button";

type Engine = (typeof SUBSCRIPTION_ENGINES)[number];

/** Offers the machine's other signed-in accounts when this chat's account reaches a plan limit. */
export function AgentLimitPrompt({ agent, canEdit }: { agent: AgentInfo; canEdit: boolean }) {
  const connection = useContext(TerminalConnectionContext);
  const paneVisible = useContext(PaneVisibilityContext);
  const tabVisible = useTabVisible();
  const engine = agent.engine ?? agent.provider;
  if (
    !agent.limit ||
    !canEdit ||
    !paneVisible ||
    !tabVisible ||
    !connection ||
    connection.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes(PROVIDER_SUBSCRIPTIONS_CAPABILITY) ||
    !(SUBSCRIPTION_ENGINES as readonly string[]).includes(engine)
  )
    return null;
  return (
    <LimitPrompt
      // Each limit is its own: a dismissed one does not hide the next.
      key={`${connection.endpoint.url}:${agent.id}:${agent.limit.resetsAt ?? ""}`}
      engine={engine as Engine}
      resetsAt={agent.limit.resetsAt}
      connection={connection}
      usageSupported={!!connection.state.daemon.capabilities?.includes(PROVIDER_USAGE_CAPABILITY)}
    />
  );
}

interface Choice {
  provider: ProviderStatus;
  /** The signed-in account's own name (an email), when it is signed in on this machine. */
  label: string | null;
  usage: AgentPlanUsage | null;
}

function LimitPrompt({
  engine,
  resetsAt,
  connection,
  usageSupported,
}: {
  engine: Engine;
  resetsAt: string | null;
  connection: DaemonConnection;
  usageSupported: boolean;
}) {
  const [revision, setRevision] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [reload, setReload] = useState(0);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const request = (operation: Parameters<DaemonConnection["requestProvider"]>[0]) =>
      connection.requestProvider(operation, crypto.randomUUID());
    void request({ kind: "list" }).then(
      async ({ outcome }) => {
        if (cancelled || outcome.status !== "ok") return;
        setRevision(outcome.revision);
        await Promise.all(
          limitSwitchChoices(outcome.providers, engine).map(async (provider) => {
            // Only an account already signed in on this machine can take over straight away.
            const account = await request({
              kind: "account",
              id: provider.id,
              action: { type: "read" },
            }).catch(() => null);
            if (
              cancelled ||
              account?.outcome.status !== "ok" ||
              account.outcome.account?.status !== "connected"
            )
              return;
            const label = account.outcome.account.label ?? null;
            setChoices((current) => ({
              ...current,
              [provider.id]: { provider, label, usage: null },
            }));
            // The machine's own sign-in cannot be measured while a subscription stands in for it.
            if (!usageSupported || !provider.subscription) return;
            const usage = await request({ kind: "usage", id: provider.id }).catch(() => null);
            if (cancelled || usage?.outcome.status !== "ok" || !usage.outcome.usage) return;
            const measured = usage.outcome.usage;
            setChoices((current) => {
              const choice = current[provider.id];
              return choice
                ? { ...current, [provider.id]: { ...choice, usage: measured } }
                : current;
            });
          }),
        );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [connection, engine, usageSupported, reload]);

  const available = Object.values(choices)
    // An account that is itself at its limit is no way out.
    .filter((choice) => (busiestWindow(choice.usage) ?? 0) < 100)
    .sort((a, b) => (busiestWindow(a.usage) ?? 50) - (busiestWindow(b.usage) ?? 50));
  if (hidden || !available.length) return null;

  const activate = async (choice: Choice) => {
    if (revision === null) return;
    setSwitching(choice.provider.id);
    setError(null);
    try {
      const result = await connection.requestProvider(
        {
          kind: "activate",
          engine,
          id: choice.provider.subscription ? choice.provider.id : null,
          expectedRevision: revision,
        },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      invalidateModelCatalogs(connection);
      // The machine clears the limit once it has switched, which removes this prompt.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch accounts");
      // A stale revision means another client changed the settings; read them again.
      setReload((n) => n + 1);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <section aria-label="Usage limit" className="rounded-xl border bg-muted/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{limitHeadline(engine, resetsAt)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Switch this machine to another account to keep going. Every chat here moves to it once
            its current turn ends.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Dismiss usage limit"
          onClick={() => setHidden(true)}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {available.map((choice) => {
          const entry = libraryFromProviders([choice.provider])[0];
          const name = entry
            ? accountName(entry, choice.label ? { [entry.id]: choice.label } : {})
            : (choice.label ?? "Default account");
          const detail = choice.provider.subscription
            ? usageGlance(choice.usage)
            : "This machine's own sign-in";
          return (
            <li key={choice.provider.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{name}</span>
                {detail && (
                  <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                )}
              </span>
              <Button
                variant="outline"
                aria-label={`Switch to ${name}`}
                disabled={switching !== null || revision === null}
                onClick={() => void activate(choice)}
              >
                {switching === choice.provider.id ? "Switching…" : "Switch"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
