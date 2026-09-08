import {
  Bell,
  CreditCard,
  KeyRound,
  Palette,
  Settings2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type SettingsPage =
  "account" | "appearance" | "notifications" | "billing" | "ssh-keys" | "advanced";

export interface SettingsNavItem {
  readonly page: SettingsPage;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface SettingsNavGroup {
  readonly label: string;
  readonly items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Personal",
    items: [
      { page: "account", label: "Account", icon: UserRound },
      { page: "appearance", label: "Appearance", icon: Palette },
      { page: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { page: "billing", label: "Billing", icon: CreditCard },
      { page: "ssh-keys", label: "SSH keys", icon: KeyRound },
    ],
  },
  {
    label: "Developer",
    items: [{ page: "advanced", label: "Advanced", icon: Settings2 }],
  },
];

export function settingsNavItemFor(page: SettingsPage): SettingsNavItem {
  return (
    SETTINGS_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.page === page) ??
    SETTINGS_NAV_GROUPS[0]!.items[0]!
  );
}
