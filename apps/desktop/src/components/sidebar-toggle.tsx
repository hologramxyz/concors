import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { cn } from "cn";

/**
 * Opens and closes the sidebar. Beside the macOS traffic lights it keeps one place in the title
 * bar in both states, so the collapsed sidebar draws it in the content's top row instead.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <SidebarTooltip place="title-bar" content={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      <button
        id={collapsed ? "expand-sidebar" : "collapse-sidebar"}
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-controls="app-sidebar"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
          className,
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-5" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-5" aria-hidden="true" />
        )}
      </button>
    </SidebarTooltip>
  );
}
