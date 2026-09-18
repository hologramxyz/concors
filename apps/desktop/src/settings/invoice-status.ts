type InvoiceStatusTone = "success" | "info" | "warning" | "danger" | "neutral";

const STATUS_TONE: Readonly<Record<string, InvoiceStatusTone>> = {
  paid: "success",
  open: "info",
  pending: "warning",
  past_due: "danger",
  uncollectible: "danger",
  draft: "neutral",
  void: "neutral",
};

const TONE_CLASS: Record<InvoiceStatusTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

/** Turn Stripe's machine-readable invoice state into a readable, semantic badge. */
export function describeInvoiceStatus(status: string | null): {
  readonly label: string;
  readonly className: string;
} {
  const normalized = status?.trim().toLowerCase() || "unknown";
  const words = normalized.replace(/[_-]+/g, " ");
  const label = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  return {
    label,
    className: TONE_CLASS[STATUS_TONE[normalized] ?? "neutral"],
  };
}
