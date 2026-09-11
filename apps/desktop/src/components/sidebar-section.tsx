import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SidebarSection({
  title,
  action,
  children,
  compact = false,
  icon,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  icon?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return (
    <section aria-label={title}>
      <div
        className={`group/section flex items-center gap-1 rounded-md focus-within:bg-sidebar-accent hover:bg-sidebar-accent ${compact ? "h-[32px] justify-center" : "h-8"}`}
      >
        {compact && action ? (
          <>
            <h2 className="sr-only">{title}</h2>
            {action}
          </>
        ) : (
          <h2 className="min-w-0 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={id}
                  onClick={() => setExpanded(!expanded)}
                  className={`flex items-center rounded-md text-ui font-medium text-muted-foreground group-hover/section:text-sidebar-foreground ${compact ? "sidebar-rail-control" : "h-8 w-full gap-2 px-2 py-1.5"}`}
                >
                  {compact ? (
                    <span aria-hidden="true">{icon}</span>
                  ) : (
                    <ChevronRight
                      className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                  )}
                  <span className={compact ? "sr-only" : undefined}>{title}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side={compact ? "right" : "bottom"} sideOffset={6}>
                {title} · {expanded ? "Hide" : "Show"}
              </TooltipContent>
            </Tooltip>
          </h2>
        )}
        {!compact && action}
      </div>
      <div id={id} hidden={!expanded && !(compact && action)}>
        {children}
      </div>
    </section>
  );
}
