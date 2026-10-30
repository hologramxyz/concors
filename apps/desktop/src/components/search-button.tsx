import { Search } from "lucide-react";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { useShortcutLabels } from "@/shortcuts/preferences-context";

/**
 * Opens search. It sits beside the sidebar toggle, and stays there with it when the sidebar
 * collapses.
 */
export function SearchButton({
  collapsed,
  onOpenSearch,
  tour,
}: {
  collapsed: boolean;
  onOpenSearch: () => void;
  /** Marks the one copy the product tour points at. */
  tour?: boolean;
}) {
  const shortcutLabel = useShortcutLabels();
  return (
    <SidebarTooltip collapsed={collapsed}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Search"
          data-tour={tour ? "search" : undefined}
          onClick={onOpenSearch}
          className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Search className="size-5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Search ({shortcutLabel("search")})</TooltipContent>
    </SidebarTooltip>
  );
}
