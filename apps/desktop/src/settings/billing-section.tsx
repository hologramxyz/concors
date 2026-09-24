import { ApiError, type Organization } from "@concors/api-client";
import { CreditCard, ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";

import { useApiResource } from "@/data/api-resource";
import { useBilling } from "@/billing/use-billing";
import { useBillingPortal } from "@/billing/use-billing-portal";
import { PaymentFailedWarning } from "@/billing/payment-failed-warning";
import { api } from "@/auth/api";
import { describeAuthError } from "@/auth/auth-state";
import { formatMoney, formatMonthly } from "@/machines/format";
import { openExternal } from "@/tauri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { Row, Section, SettingsCard } from "@/views/settings-primitives";
import { describeInvoiceStatus } from "./invoice-status";

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
  const { status, refresh: refreshBilling } = billing;
  const invoiceQuery = useApiResource(`invoices:${organizationId ?? ""}`, () =>
    api.listInvoices(scope),
  );
  const invoices = invoiceQuery.data;
  const [addingCard, setAddingCard] = useState(false);

  const reload = useCallback(() => {
    refreshBilling();
    void invoiceQuery.resource.load(30_000, true);
  }, [refreshBilling, invoiceQuery.resource]);
  const portal = useBillingPortal(organizationId, reload);
  const busy = addingCard || portal.opening;

  function addCard() {
    setAddingCard(true);
    void billing.addCard().finally(() => setAddingCard(false));
  }

  return (
    <Section
      title="Billing"
      description={
        status?.waived
          ? "What machines cost this organization."
          : "Each machine is a monthly subscription charged in advance to this organization’s card."
      }
    >
      {(portal.error ??
        billing.error ??
        (invoiceQuery.error ? describeApiError(invoiceQuery.error) : null)) && (
        <p role="alert" className="py-2 text-sm text-destructive">
          {portal.error ??
            billing.error ??
            (invoiceQuery.error ? describeApiError(invoiceQuery.error) : null)}
        </p>
      )}
      {status === null && !billing.error ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Loading billing…
        </p>
      ) : status?.configured === false ? (
        <p className="py-2 text-sm text-muted-foreground">
          This Concors server runs without billing; machines are not charged.
        </p>
      ) : status?.waived ? (
        <p className="py-2 text-sm text-muted-foreground">
          Machines in this organization are not charged.
        </p>
      ) : status ? (
        <>
          <PaymentFailedWarning
            className="mb-4"
            organizationId={organizationId}
            paymentFailedAt={status.paymentFailedAt}
            atRisk={null}
            onReturn={reload}
          />
          <SettingsCard className="divide-y">
            <Row
              label="Payment method"
              hint="Saved with Stripe; Concors never sees the card number."
            >
              <span className="flex flex-wrap items-center justify-end gap-2">
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
            <div className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={status.hasPaymentMethod ? "outline" : "default"}
                  size="sm"
                  disabled={busy || billing.checkout !== null}
                  onClick={addCard}
                >
                  <CreditCard data-icon="inline-start" aria-hidden="true" />
                  {addingCard
                    ? "Opening…"
                    : status.hasPaymentMethod
                      ? "Add another card"
                      : "Add a card"}
                </Button>
                {status.hasPaymentMethod && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={portal.open}>
                    <ExternalLink data-icon="inline-start" aria-hidden="true" />
                    {portal.opening ? "Opening…" : "Manage billing"}
                  </Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={reload}>
                  Refresh
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Cards are added on a Stripe page in your browser. Your card updates here after
                setup.
              </p>
            </div>
          </SettingsCard>
          {billing.checkout && (
            <div className="mt-3 flex gap-2">
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
            <SettingsCard className="mt-4">
              <div className="border-b px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Invoices
              </div>
              <ul className="flex flex-col divide-y">
                {invoices.map((invoice) => {
                  const invoiceUrl = invoice.hostedInvoiceUrl;
                  const status = describeInvoiceStatus(invoice.status);
                  return (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {formatDate(invoice.createdAt)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {invoice.number ?? invoice.id}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Badge variant="outline" className={status.className}>
                          {status.label}
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
            </SettingsCard>
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
