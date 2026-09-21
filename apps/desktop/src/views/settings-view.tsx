import { ProvidersSettings } from "@/settings/providers-settings";
import {
  SubscriptionsSettings,
  type SubscriptionsSettingsProps,
} from "@/settings/subscriptions-settings";
import { NotificationSettings } from "@/notifications/settings";
import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import type { ReactNode } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountSettings } from "@/settings/account-settings";
import { MachinesView, type MachinesViewProps } from "@/machines/machines-view";
import { AdvancedSettings } from "@/settings/advanced-settings";
import { AppearanceSettings } from "@/settings/appearance-settings";
import { BillingSection } from "@/settings/billing-section";
import type { SettingsPage } from "@/settings/navigation";
import { SshKeysSection } from "@/settings/ssh-keys-section";
import { ShortcutSettings } from "@/settings/shortcut-settings";
import { TerminalsSettings } from "@/settings/terminals-settings";
import type { ThemePreference } from "@/theme/use-theme";
import type { CornerStyle } from "@/theme/use-corner-style";

interface SettingsViewProps {
  readonly creatingTerminalProfile: boolean;
  readonly onCreatingTerminalProfileChange: (creating: boolean) => void;
  readonly page: SettingsPage;
  readonly machines?: Omit<MachinesViewProps, "auth">;
  readonly subscriptions?: Omit<SubscriptionsSettingsProps, "auth">;
  readonly endpoint: DaemonEndpoint | null;
  readonly state: ConnectionState;
  readonly apiUrl?: string;
  readonly endpointLabel?: string;
  readonly clientVersion?: string;
  readonly buildVersion?: string | null;
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly cornerStyle: CornerStyle;
  readonly onSetCornerStyle: (style: CornerStyle) => void;
  readonly auth: SignedInAuth;
  readonly onSetActiveOrganization: (organizationId: string) => unknown;
}

export function SettingsView({
  creatingTerminalProfile,
  onCreatingTerminalProfileChange,
  page,
  machines,
  subscriptions,
  endpoint,
  state,
  apiUrl,
  endpointLabel,
  clientVersion,
  buildVersion,
  theme,
  onSetTheme,
  cornerStyle,
  onSetCornerStyle,
  auth,
  onSetActiveOrganization,
}: SettingsViewProps) {
  const organization = activeOrganization(auth);
  let content: ReactNode;

  switch (page) {
    case "machines":
      content = <MachinesView key={organization?.id} auth={auth} {...machines} />;
      break;
    case "providers":
      content = <ProvidersSettings />;
      break;
    case "subscriptions":
      content = <SubscriptionsSettings auth={auth} {...subscriptions} />;
      break;
    case "terminals":
      content = (
        <TerminalsSettings
          creating={creatingTerminalProfile}
          onCreatingChange={onCreatingTerminalProfileChange}
        />
      );
      break;
    case "account":
      content = <AccountSettings auth={auth} onSetActiveOrganization={onSetActiveOrganization} />;
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
      content = (
        <AdvancedSettings
          endpoint={endpoint}
          state={state}
          {...(apiUrl ? { apiUrl } : {})}
          {...(endpointLabel ? { endpointLabel } : {})}
          {...(clientVersion ? { clientVersion } : {})}
          {...(buildVersion !== undefined ? { buildVersion } : {})}
        />
      );
      break;
    default: {
      const unhandledPage: never = page;
      throw new Error(`Unhandled settings page: ${unhandledPage}`);
    }
  }

  return (
    <div
      className={`mx-auto w-full px-4 py-6 sm:px-6 ${page === "subscriptions" ? "max-w-5xl" : "max-w-3xl"}`}
    >
      {content}
    </div>
  );
}
