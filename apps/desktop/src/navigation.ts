import { Bot, FolderKanban, House, Server, Settings, type LucideIcon } from "lucide-react";

export type View = "home" | "agents" | "projects" | "daemons" | "settings";

export interface NavItem {
  readonly view: View;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Keyboard shortcut shown in menus (G then key, Linear-style "go to" chords). */
  readonly shortcut?: string;
  /** Sections that exist in the navigation but have no UI yet. */
  readonly comingSoon?: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { view: "home", label: "Home", icon: House, shortcut: "G H" },
  { view: "agents", label: "Agents", icon: Bot, comingSoon: true },
  { view: "projects", label: "Projects", icon: FolderKanban, comingSoon: true },
  { view: "daemons", label: "Daemons", icon: Server, comingSoon: true },
];

export const SETTINGS_NAV: NavItem = {
  view: "settings",
  label: "Settings",
  icon: Settings,
  shortcut: "G S",
};

export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, SETTINGS_NAV];

export function navItemFor(view: View): NavItem {
  return ALL_NAV.find((item) => item.view === view) ?? SETTINGS_NAV;
}
