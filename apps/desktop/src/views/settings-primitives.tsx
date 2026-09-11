import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";

/** Layout blocks of the settings page, shared with the org-scoped sections in `src/settings/`. */

export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <section data-settings-section className="mb-10 min-w-0 [overflow-wrap:anywhere] last:mb-0">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      <Separator className="my-4" />
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-settings-row
      className="flex flex-col gap-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="min-w-0 sm:max-w-[45%] sm:shrink-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="selectable max-w-full min-w-0 text-muted-foreground">{children}</div>
    </div>
  );
}

export function Mono({ children }: { readonly children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}
