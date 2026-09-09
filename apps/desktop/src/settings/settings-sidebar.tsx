import { ArrowLeft } from "lucide-react";
import { cn } from "cn";

import { SETTINGS_NAV_GROUPS, type SettingsPage } from "./navigation";

interface SettingsSidebarProps {
  readonly page: SettingsPage;
  readonly onBack: () => void;
  readonly onNavigate: (page: SettingsPage) => void;
}

export function SettingsSidebar({ page, onBack, onNavigate }: SettingsSidebarProps) {
  return (
    <div className="sidebar-shell">
      <nav
        id="app-sidebar"
        aria-label="Settings"
        className="flex h-full w-[216px] flex-col bg-sidebar text-ui text-sidebar-foreground"
      >
        <div className="m-2 flex h-9 items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Back to app</span>
          </button>
        </div>

        <div className="px-4 pt-4 pb-3">
          <h1 className="text-sm font-semibold text-sidebar-accent-foreground">Settings</h1>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-2">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <section key={group.label} aria-labelledby={`settings-group-${group.label}`}>
              <h2
                id={`settings-group-${group.label}`}
                className="mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground"
              >
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.page === page;
                  return (
                    <li key={item.page}>
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavigate(item.page)}
                        className={cn(
                          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </nav>
    </div>
  );
}
