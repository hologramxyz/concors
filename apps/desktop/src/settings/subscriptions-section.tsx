import type { MachineSubscription } from "@concors/api-client";
import { useEffect, useState } from "react";

import { api } from "@/auth/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { formatMonthly } from "@/machines/format";
import { describeMachinesError } from "@/machines/use-machines";
import { Section } from "@/views/settings-primitives";

const STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  incomplete: "Payment pending",
  paused: "Paused",
};

export function SubscriptionsSection({
  organizationId,
  organizationName,
}: {
  readonly organizationId: string;
  readonly organizationName: string;
}) {
  const [subscriptions, setSubscriptions] = useState<MachineSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api
      .listMachineSubscriptions({ organizationId })
      .then((list) => {
        if (cancelled) return;
        setSubscriptions(list);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeMachinesError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, generation]);
  useEffect(() => {
    const refresh = () => setGeneration((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  return (
    <Section
      title="VPS subscriptions"
      description={`Monthly subscriptions for ${organizationName}.`}
    >
      {error && (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {subscriptions === null && !error && (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Loading subscriptions…
        </p>
      )}
      {subscriptions?.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">
          No VPS subscriptions yet. Create a cloud VPS from the workspace’s machine menu.
        </p>
      )}
      <ul className="divide-y">
        {subscriptions?.map((subscription) => (
          <li key={subscription.id} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{subscription.machineName}</span>
              <Badge
                variant={
                  ["past_due", "unpaid", "incomplete"].includes(subscription.status)
                    ? "destructive"
                    : "outline"
                }
              >
                {subscription.cancelAtPeriodEnd
                  ? "Ends at period end"
                  : (STATUS[subscription.status] ?? subscription.status)}
              </Badge>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span className="capitalize">
                {subscription.size} · {subscription.region}
              </span>
              <span>{formatMonthly(subscription.monthlyPrice)}</span>
            </div>
            {subscription.currentPeriodEnd && (
              <p className="text-xs text-muted-foreground">
                {subscription.cancelAtPeriodEnd
                  ? "Ends"
                  : ["active", "trialing"].includes(subscription.status)
                    ? "Renews"
                    : "Current period ends"}{" "}
                {formatDate(subscription.currentPeriodEnd)}
              </p>
            )}
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={() => setGeneration((n) => n + 1)}>
        Refresh subscriptions
      </Button>
    </Section>
  );
}
