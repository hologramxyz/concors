import { Clock } from "lucide-react";
import { cn } from "cn";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { useSchedules } from "./use-schedules";
export function SchedulesNav({
  selected,
  compact = false,
  onClick,
}: {
  selected: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const { schedules } = useSchedules();
  const count = schedules?.filter((s) => s.enabled).length ?? 0;
  return (
    <SidebarTooltip collapsed={compact}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label="Schedules"
          aria-current={selected ? "page" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent",
            selected ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground",
            compact && "sidebar-rail-control justify-center px-0",
          )}
        >
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          {!compact && (
            <>
              <span className="flex-1 text-left">Schedules</span>
              {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Schedules</TooltipContent>
    </SidebarTooltip>
  );
}
