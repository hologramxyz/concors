import {
  Bell,
  CreditCard,
  KeyRound,
  Palette,
  Settings2,
  UserRound,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export type SettingsPage =
  "account" | "appearance" | "notifications" | "terminals" | "billing" | "ssh-keys" | "advanced";

export interface SettingsNavItem {
  readonly page: SettingsPage;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface SettingsNavGroup {
  readonly label: string;
  readonly items: readonly SettingsNavItem[];
}

const ACCOUNT_SETTINGS_ITEM: SettingsNavItem = {
  page: "account",
  label: "Account",
  icon: UserRound,
};

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Personal",
    items: [
      ACCOUNT_SETTINGS_ITEM,
      { page: "appearance", label: "Appearance", icon: Palette },
      { page: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { page: "terminals", label: "Terminals", icon: Terminal },
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
    ACCOUNT_SETTINGS_ITEM
  );
}
