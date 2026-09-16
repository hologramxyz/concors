import { CalendarClock, FolderKanban, Server, Settings, type LucideIcon } from "lucide-react";

export type View = "projects" | "servers" | "schedules" | "settings";

export interface NavItem {
  readonly view: View;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Sections that exist in the navigation but have no UI yet. */
  readonly comingSoon?: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { view: "schedules", label: "Schedules", icon: CalendarClock },
  { view: "projects", label: "Projects", icon: FolderKanban },
  { view: "servers", label: "Servers", icon: Server },
];

export const SETTINGS_NAV: NavItem = {
  view: "settings",
  label: "Settings",
  icon: Settings,
};

export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, SETTINGS_NAV];

export function navItemFor(view: View): NavItem {
  return ALL_NAV.find((item) => item.view === view) ?? SETTINGS_NAV;
}
