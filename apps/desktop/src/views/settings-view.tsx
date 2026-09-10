import { NotificationSettings } from "@/notifications/settings";
import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import type { ReactNode } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountSettings } from "@/settings/account-settings";
import { AdvancedSettings } from "@/settings/advanced-settings";
import { AppearanceSettings } from "@/settings/appearance-settings";
import { BillingSection } from "@/settings/billing-section";
import type { SettingsPage } from "@/settings/navigation";
import { SshKeysSection } from "@/settings/ssh-keys-section";
import { ShortcutSettings } from "@/settings/shortcut-settings";
import type { ThemePreference } from "@/theme/use-theme";
import type { CornerStyle } from "@/theme/use-corner-style";

interface SettingsViewProps {
  readonly page: SettingsPage;
  readonly endpoint: DaemonEndpoint | null;
  readonly state: ConnectionState;
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly cornerStyle: CornerStyle;
  readonly onSetCornerStyle: (style: CornerStyle) => void;
  readonly auth: SignedInAuth;
  readonly onSignOut: () => void;
  readonly onSetActiveOrganization: (organizationId: string) => void;
}

export function SettingsView({
  page,
  endpoint,
  state,
  theme,
  onSetTheme,
  cornerStyle,
  onSetCornerStyle,
  auth,
  onSignOut,
  onSetActiveOrganization,
}: SettingsViewProps) {
  const organization = activeOrganization(auth);
  let content: ReactNode;

  switch (page) {
    case "account":
      content = (
        <AccountSettings
          auth={auth}
          onSignOut={onSignOut}
          onSetActiveOrganization={onSetActiveOrganization}
        />
      );
      break;
    case "appearance":
      content = (
        <AppearanceSettings
          theme={theme}
          onSetTheme={onSetTheme}
          cornerStyle={cornerStyle}
          onSetCornerStyle={onSetCornerStyle}
        />
      );
      break;
    case "shortcuts":
      content = <ShortcutSettings />;
      break;
    case "notifications":
      content = <NotificationSettings />;
      break;
    case "billing":
      content = (
        <BillingSection key={`billing-${organization?.id ?? ""}`} organization={organization} />
      );
      break;
    case "ssh-keys":
      content = (
        <SshKeysSection key={`keys-${organization?.id ?? ""}`} organization={organization} />
      );
      break;
    case "advanced":
      content = <AdvancedSettings endpoint={endpoint} state={state} />;
      break;
    default: {
      const unhandledPage: never = page;
      throw new Error(`Unhandled settings page: ${unhandledPage}`);
    }
  }

  return <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{content}</div>;
}
