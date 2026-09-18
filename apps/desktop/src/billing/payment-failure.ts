/**
 * The wording shown when an organization's card stops working.
 *
 * This is the only warning anyone gets. Stripe emails the cardholder, but the person looking at
 * the app may not be them, and a machine that dies takes its disk with it — so the app says it
 * plainly, in front of the machines it is about. Kept pure so the copy can be tested without React.
 *
 * Deliberately vague about *when* a machine dies. Stripe retries on a schedule of its own and the
 * server only learns the outcome afterwards, through `customer.subscription.deleted`; inventing a
 * deadline here would be worse than admitting there isn't one to show.
 */

export interface PaymentFailureWarning {
  readonly title: string;
  readonly detail: string;
}

/**
 * `null` when the card is fine. `atRisk` is how many machines the card still pays for, or `null`
 * where the caller does not know — the settings page has no machine list to count.
 */
export function describePaymentFailure(
  paymentFailedAt: string | null,
  atRisk: number | null,
  locale?: string,
): PaymentFailureWarning | null {
  if (paymentFailedAt === null) return null;
  const when = formatDay(paymentFailedAt, locale);
  const on = when === null ? "" : ` on ${when}`;

  if (atRisk === 0)
    return {
      title: "Payment failed",
      detail: `We couldn’t charge your card${on}. Update it before creating a machine.`,
    };

  return {
    title: "Payment failed — your machines will be deleted",
    detail:
      `We couldn’t charge your card${on}. Stripe will retry over the next few days. ` +
      `If the payment keeps failing, ${subject(atRisk)} permanently deleted, ` +
      `along with everything on ${object(atRisk)}. This cannot be undone.`,
  };
}

function subject(atRisk: number | null): string {
  if (atRisk === 1) return "your machine will be";
  if (atRisk === null) return "your machines will be";
  return `all ${atRisk} of your machines will be`;
}

function object(atRisk: number | null): string {
  return atRisk === 1 ? "it" : "them";
}

/** `Sep 18, 2026`, or `null` when the server sent something that is not a date. */
function formatDay(iso: string, locale?: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(locale, { dateStyle: "medium" });
}
