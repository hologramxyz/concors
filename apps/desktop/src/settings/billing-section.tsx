import { ApiError, type Invoice, type Organization } from "@concors/api-client";
import { CreditCard, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { useBilling } from "@/billing/use-billing";
import { api } from "@/auth/api";
import { describeAuthError } from "@/auth/auth-state";
import { formatMoney, formatMonthly } from "@/machines/format";
import { openExternal } from "@/tauri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { Row, Section } from "@/views/settings-primitives";

interface BillingSectionProps {
  readonly organization: Organization | undefined;
}

/**
 * How the organization pays for machines. Cards are handled on Stripe's hosted pages, opened in
 * the system browser; the status here reflects what the server learned back from Stripe.
 */
export function BillingSection({ organization }: BillingSectionProps) {
  const organizationId = organization?.id;
  const scope = organizationId === undefined ? {} : { organizationId };
  const billing = useBilling(organizationId ?? "");
  const { status } = billing;
  const [invoices, setInvoices] = useState<readonly Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"setup" | "portal" | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.listInvoices(scope)])
      .then(([loadedInvoices]) => {
        if (cancelled) return;
        setInvoices(loadedInvoices);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeApiError(cause));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, generation]);

  function open(kind: "setup" | "portal") {
    setPending(kind);
    setError(null);
    if (kind === "setup") {
      void billing.addCard().finally(() => setPending(null));
      return;
    }
    const url = api.createBillingPortalUrl(scope);
    void url
      .then(openExternal)
      .catch((cause: unknown) => setError(describeApiError(cause)))
      .finally(() => setPending(null));
  }

  return (
    <Section
      title="Billing"
      description="Each machine is a monthly subscription charged in advance to this organization’s card."
    >
      {(error ?? billing.error) && (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error ?? billing.error}
        </p>
      )}
      {status === null && !error ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Loading billing…
        </p>
      ) : status?.configured === false ? (
        <p className="py-2 text-sm text-muted-foreground">
          This Concors server runs without billing; machines are not charged.
        </p>
      ) : status ? (
        <>
          <Row
            label="Payment method"
            hint={
              status.paymentFailedAt
                ? `A payment failed on ${formatDate(status.paymentFailedAt)}. Update the card to keep your machines.`
                : "Saved with Stripe; Concors never sees the card number."
            }
          >
            <span className="flex items-center gap-2">
              {status.card ? (
                <>
                  <CreditCard className="size-4" aria-hidden="true" />
                  <span className="capitalize">{status.card.brand}</span> ···· {status.card.last4}
                  <span className="text-xs">
                    {String(status.card.expMonth).padStart(2, "0")}/{status.card.expYear}
                  </span>
                  {status.paymentFailedAt && <Badge variant="destructive">Payment failed</Badge>}
                </>
              ) : status.hasPaymentMethod ? (
                "Card on file"
              ) : (
                <Badge variant="outline">No card yet</Badge>
              )}
            </span>
          </Row>
          <Row label="Prices" hint="Per machine, per month.">
            <span className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
              {status.prices.map((price) => (
                <span key={price.size}>
                  <span className="capitalize">{price.size}</span>{" "}
                  {formatMonthly(price.monthlyPrice)}
                </span>
              ))}
            </span>
          </Row>
          <div className="flex flex-wrap items-center gap-2 py-2.5">
            <Button
              variant={status.hasPaymentMethod ? "outline" : "default"}
              size="sm"
              disabled={pending !== null || billing.checkout !== null}
              onClick={() => open("setup")}
            >
              <CreditCard data-icon="inline-start" aria-hidden="true" />
              {pending === "setup"
                ? "Opening…"
                : status.hasPaymentMethod
                  ? "Add another card"
                  : "Add a card"}
            </Button>
            {status.hasPaymentMethod && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => open("portal")}
              >
                <ExternalLink data-icon="inline-start" aria-hidden="true" />
                {pending === "portal" ? "Opening…" : "Manage billing"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending !== null}
              onClick={() => {
                billing.refresh();
                setGeneration((n) => n + 1);
              }}
            >
              Refresh
            </Button>
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            Cards are added on a Stripe page in your browser. Your card updates here after setup.
          </p>
          {billing.checkout && (
            <div className="flex gap-2">
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  if (billing.checkout) void openExternal(billing.checkout.url);
                }}
              >
                Open Stripe again
              </Button>
              <Button variant="ghost" size="sm" onClick={billing.stopWaiting}>
                Back to payment
              </Button>
            </div>
          )}
          {invoices && invoices.length > 0 && (
            <div className="pt-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                Invoices
              </div>
              <ul className="flex flex-col">
                {invoices.map((invoice) => {
                  const invoiceUrl = invoice.hostedInvoiceUrl;
                  return (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-4 py-1.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {formatDate(invoice.createdAt)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {invoice.number ?? invoice.id}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Badge variant={invoice.status === "paid" ? "outline" : "destructive"}>
                          {invoice.status ?? "unknown"}
                        </Badge>
                        <span>{formatMoney(invoice.amountDue)}</span>
                        {invoiceUrl && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Open invoice"
                            onClick={() => void openExternal(invoiceUrl)}
                          >
                            <ExternalLink aria-hidden="true" />
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </Section>
  );
}

function describeApiError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status < 500) return cause.message;
  return describeAuthError(cause);
}
