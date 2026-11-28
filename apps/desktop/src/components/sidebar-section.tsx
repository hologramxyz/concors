import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function SidebarSection({
  title,
  action: actionOf,
  children,
  compact = false,
  icon,
  label = false,
  defaultExpanded = true,
}: {
  title: string;
  /** Beside the title; given as a function, it is drawn for whether the section is open. */
  action?: ReactNode | ((expanded: boolean) => ReactNode);
  children: ReactNode;
  compact?: boolean;
  icon?: ReactNode;
  /** Titled in the small label style, a divider between groups rather than a heading. */
  label?: boolean;
  /** Whether the section starts open; it is not remembered once toggled. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const action = typeof actionOf === "function" ? actionOf(expanded) : actionOf;
  const id = useId();
  return (
    <section aria-label={title}>
      <div
        className={`group/section flex items-center gap-1 rounded-md hover:bg-sidebar-accent/70 has-[:focus-visible:not([data-pointer-focus])]:bg-sidebar-accent/70 ${compact ? "h-[32px] justify-center" : label ? "h-7" : "h-8"}`}
      >
        {compact && action ? (
          <>
            <h2 className="sr-only">{title}</h2>
            {action}
          </>
        ) : (
          <h2 className="min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded(!expanded)}
              className={`flex items-center rounded-md font-medium text-muted-foreground group-hover/section:text-sidebar-foreground ${label ? "text-xs" : "text-ui"} ${compact ? "sidebar-rail-control" : `${label ? "h-7" : "h-8"} w-full gap-2 px-2 py-1.5`}`}
            >
              {compact ? (
                <span aria-hidden="true">{icon}</span>
              ) : (
                <ChevronRight
                  className={`${label ? "size-3.5" : "size-4"} transition-transform ${expanded ? "rotate-90" : ""}`}
                />
              )}
              <span className={compact ? "sr-only" : undefined}>{title}</span>
            </button>
          </h2>
        )}
        {!compact && action}
      </div>
      <div
        id={id}
        className="sidebar-collapse"
        data-collapsed={(!expanded && !(compact && action)) || undefined}
      >
        <div>{children}</div>
      </div>
    </section>
  );
}

/**
 * What a sidebar section says when it has nothing to list.
 *
 * Indented to sit under the section's own name, one step quieter and smaller than both the heading
 * above it and a real item, so an empty section reads as absence rather than as something to act
 * on. All three sections share this so they cannot drift apart again.
 */
export function SidebarEmpty({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  /** `alert` keeps the same shape for a failure, which is still not a list item. */
  tone?: "muted" | "alert";
}) {
  return (
    <p
      {...(tone === "alert" ? { role: "alert" } : {})}
      className={`mt-1 py-1.5 pr-2 pl-8 text-xs ${
        tone === "alert" ? "text-destructive" : "text-muted-foreground/70"
      }`}
    >
      {children}
    </p>
  );
}
