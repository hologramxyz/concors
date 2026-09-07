import { Bot, FolderKanban, Server, Settings, type LucideIcon } from "lucide-react";

export type View = "agents" | "projects" | "servers" | "settings";

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
  { view: "projects", label: "Projects", icon: FolderKanban },
  { view: "agents", label: "Agents", icon: Bot },
  { view: "servers", label: "Servers", icon: Server },
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
