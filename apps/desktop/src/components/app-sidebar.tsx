import { Search } from "lucide-react";
import { cn } from "cn";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { modShortcut } from "@/lib/platform";
import { PRIMARY_NAV, SETTINGS_NAV, type NavItem, type View } from "@/navigation";

interface AppSidebarProps {
  readonly view: View;
  readonly onNavigate: (view: View) => void;
  readonly onOpenCommandPalette: () => void;
}

export function AppSidebar({ view, onNavigate, onOpenCommandPalette }: AppSidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-11 items-center gap-2 px-4">
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-[5px] bg-primary text-[10px] font-semibold text-primary-foreground"
        >
          C
        </span>
        <span className="text-[13px] font-semibold text-foreground">Concors</span>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex h-7 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2 text-muted-foreground shadow-xs transition-colors hover:bg-background hover:text-foreground"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="flex-1 text-left text-xs">Search or jump to…</span>
          <Kbd className="h-4 min-w-4 text-[10px]">{modShortcut("K")}</Kbd>
        </button>
      </div>

      <ul className="flex flex-col gap-px px-2">
        {PRIMARY_NAV.map((item) => (
          <li key={item.view}>
            <SidebarItem item={item} active={view === item.view} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

      <div className="mt-auto px-2 pb-2">
        <SidebarItem
          item={SETTINGS_NAV}
          active={view === SETTINGS_NAV.view}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

interface SidebarItemProps {
  readonly item: NavItem;
  readonly active: boolean;
  readonly onNavigate: (view: View) => void;
}

function SidebarItem({ item, active, onNavigate }: SidebarItemProps) {
  const Icon = item.icon;
  const button = (
    <button
      type="button"
      disabled={item.comingSoon}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(item.view)}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        item.comingSoon && "cursor-default opacity-50 hover:bg-transparent",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate text-left">{item.label}</span>
      {item.comingSoon && (
        <span className="rounded-sm border border-sidebar-border px-1 text-[10px] leading-4 text-muted-foreground">
          Soon
        </span>
      )}
    </button>
  );

  if (!item.shortcut || item.comingSoon) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {item.label}
        <Kbd>{item.shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
