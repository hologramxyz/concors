/**
 * The banner shown when an organization's card has stopped working.
 *
 * It is not dismissible on purpose. Everything else the app warns about is recoverable; this one
 * ends with machines being destroyed, so it stays until the card is fixed.
 */
import { CreditCard, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

import { describePaymentFailure } from "./payment-failure.ts";
import { useBillingPortal } from "./use-billing-portal.ts";

interface PaymentFailedWarningProps {
  readonly organizationId: string | undefined;
  /** When the last charge failed; `null` hides the warning entirely. */
  readonly paymentFailedAt: string | null;
  /** Machines the card still pays for, or `null` where the caller cannot count them. */
  readonly atRisk: number | null;
  /** Re-read billing after the portal closes, so a fixed card clears the banner. */
  readonly onReturn: () => void;
  readonly className?: string;
}

export function PaymentFailedWarning({
  organizationId,
  paymentFailedAt,
  atRisk,
  onReturn,
  className,
}: PaymentFailedWarningProps) {
  const portal = useBillingPortal(organizationId, onReturn);
  const warning = describePaymentFailure(paymentFailedAt, atRisk);
  if (!warning) return null;

  return (
    <section
      role="alert"
      aria-label="Payment failed"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-destructive">{warning.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{warning.detail}</p>
        {portal.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {portal.error}
          </p>
        )}
        <Button
          className="mt-3"
          size="sm"
          disabled={portal.opening || organizationId === undefined}
          onClick={portal.open}
        >
          <CreditCard data-icon="inline-start" aria-hidden="true" />
          {portal.opening ? "Opening Stripe…" : "Update payment method"}
        </Button>
      </div>
    </section>
  );
}
