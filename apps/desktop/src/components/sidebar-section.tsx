import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return (
    <section aria-label={title}>
      <div className="flex h-8 items-center gap-1">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ChevronRight
              className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            {title}
          </button>
        </h2>
        {action}
      </div>
      <div id={id} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
