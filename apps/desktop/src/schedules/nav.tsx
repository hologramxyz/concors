import { Clock } from "lucide-react";
import { cn } from "cn";
export function SchedulesNav({
  selected,
  compact = false,
  onClick,
}: {
  selected: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Schedules"
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent/50",
        selected
          ? "bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent"
          : "text-muted-foreground",
        compact && "sidebar-rail-control justify-center px-0",
      )}
    >
      <Clock className="size-4 shrink-0" aria-hidden="true" />
      {!compact && <span className="flex-1 text-left">Schedules</span>}
    </button>
  );
}
