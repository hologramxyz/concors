import { ProvidersSettings } from "@/settings/providers-settings";
import { McpSettings } from "@/settings/mcp-settings";
import { PluginsSettings } from "@/settings/plugins-settings";
import {
  SubscriptionsSettings,
  type SubscriptionsSettingsProps,
} from "@/settings/subscriptions-settings";
import { NotificationSettings } from "@/notifications/settings";
import type { ReactNode } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { Button } from "@/components/ui/button";
import { Section } from "@/views/settings-primitives";
import { AccountSettings } from "@/settings/account-settings";
import { MachinesView, type MachinesViewProps } from "@/machines/machines-view";
import { AboutSettings } from "@/settings/about-settings";
import { AppearanceSettings } from "@/settings/appearance-settings";
import { BillingSection } from "@/settings/billing-section";
import type { SettingsPage } from "@/settings/navigation";
import { SshKeysSection } from "@/settings/ssh-keys-section";
import { ShortcutSettings } from "@/settings/shortcut-settings";
import type { ThemePreference } from "@/theme/use-theme";
import type { CornerStyle } from "@/theme/use-corner-style";

interface SettingsViewProps {
  readonly page: SettingsPage;
  readonly machines?: Omit<MachinesViewProps, "auth">;
  readonly subscriptions?: Omit<SubscriptionsSettingsProps, "auth">;
  readonly apiUrl?: string;
  readonly clientVersion?: string;
  readonly buildVersion?: string | null;
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly cornerStyle: CornerStyle;
  readonly onSetCornerStyle: (style: CornerStyle) => void;
  /** Null for a guest; pages that need an account offer sign-in instead. */
  readonly auth: SignedInAuth | null;
  /** Only a guest can reach it, and the phone app has no guests. */
  readonly onSignIn?: () => void;
  readonly onSetActiveOrganization: (organizationId: string) => unknown;
}

/** A settings page that means nothing without an account says why, and offers one. */
function SignInRequired({
  title,
  description,
  onSignIn,
}: {
  title: string;
  description: string;
  onSignIn: (() => void) | undefined;
}) {
  return (
    <Section title={title} description={description}>
      <Button onClick={onSignIn}>Sign in</Button>
    </Section>
  );
}

export function SettingsView({
  page,
  machines,
  subscriptions,
  apiUrl,
  clientVersion,
  buildVersion,
  theme,
  onSetTheme,
  cornerStyle,
  onSetCornerStyle,
  auth,
  onSignIn,
  onSetActiveOrganization,
}: SettingsViewProps) {
  const organization = auth ? activeOrganization(auth) : undefined;
  let content: ReactNode;

  switch (page) {
    case "machines":
      content = auth ? (
        <MachinesView key={organization?.id} auth={auth} {...machines} />
      ) : (
        <SignInRequired
          title="Machines"
          description="You're using this computer, which needs no account. To buy a machine or connect your own server, sign in."
          onSignIn={onSignIn}
        />
      );
      break;
    case "providers":
      content = <ProvidersSettings />;
      break;
    case "mcp-servers":
      content = <McpSettings />;
      break;
    case "plugins":
      content = <PluginsSettings />;
      break;
    case "subscriptions":
      content = <SubscriptionsSettings {...(auth ? { auth } : {})} {...subscriptions} />;
      break;
    case "account":
      content = auth ? (
        <AccountSettings auth={auth} onSetActiveOrganization={onSetActiveOrganization} />
      ) : (
        <SignInRequired
          title="Account"
          description="You're using Concors on this computer without an account. Sign in to buy a machine, connect your own server, or link GitHub."
          onSignIn={onSignIn}
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
    case "about":
      content = (
        <AboutSettings
          {...(apiUrl ? { apiUrl } : {})}
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

  return <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">{content}</div>;
}
