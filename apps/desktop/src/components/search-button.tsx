import { Search } from "lucide-react";
import { SidebarTooltip } from "@/components/sidebar-tooltip";

/**
 * Opens search. It sits beside the sidebar toggle, and stays there with it when the sidebar
 * collapses.
 */
export function SearchButton({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <SidebarTooltip place="title-bar" content="Search" shortcut="search">
      <button
        type="button"
        aria-label="Search"
        onClick={onOpenSearch}
        className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>
    </SidebarTooltip>
  );
}
