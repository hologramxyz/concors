import type { ReactNode } from "react";
import { cn } from "cn";

import { Separator } from "@/components/ui/separator";

/** Layout blocks of the settings page, shared with the org-scoped sections in `src/settings/`. */

export function Section({
  title,
  description,
  actions,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-settings-section
      aria-label={title}
      className="mb-8 min-w-0 [overflow-wrap:anywhere] last:mb-0"
    >
      <SettingsSectionHeader title={title} description={description} actions={actions} />
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function SettingsSectionHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <Separator className="my-4" />
    </>
  );
}

/** A consistent surface for related settings without prescribing the controls inside it. */
export function SettingsCard({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-xl border bg-card/30", className)}>
      {children}
    </div>
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
      className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6"
    >
      <div className="min-w-0 md:max-w-[45%] md:shrink-0">
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
