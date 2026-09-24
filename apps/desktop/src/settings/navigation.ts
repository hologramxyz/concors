import {
  Bell,
  Info,
  CreditCard,
  KeyRound,
  Keyboard,
  Palette,
  UserRound,
  Cloud,
  Users,
  type LucideIcon,
} from "lucide-react";

export type SettingsPage =
  | "account"
  | "appearance"
  | "shortcuts"
  | "notifications"
  | "providers"
  | "subscriptions"
  | "machines"
  | "billing"
  | "ssh-keys"
  | "about";

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
      { page: "shortcuts", label: "Shortcuts", icon: Keyboard },
      { page: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { page: "machines", label: "Machines", icon: Cloud },
      // Providers is hidden while Concors supports only Codex, Claude Code and OpenCode: they are
      // installed when a machine is set up, and the page's own installs and updates diverge from
      // that. The page and its daemon support remain, so restoring it is this one line.
      // { page: "providers", label: "Providers", icon: Bot },
      { page: "subscriptions", label: "Subscriptions", icon: Users },
      { page: "billing", label: "Billing", icon: CreditCard },
      { page: "ssh-keys", label: "SSH keys", icon: KeyRound },
    ],
  },
  {
    label: "App",
    items: [{ page: "about", label: "About", icon: Info }],
  },
];

export function settingsNavItemFor(page: SettingsPage): SettingsNavItem {
  return (
    SETTINGS_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.page === page) ??
    ACCOUNT_SETTINGS_ITEM
  );
}
