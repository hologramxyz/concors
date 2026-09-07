import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import { PROTOCOL_VERSION } from "@concors/protocol";
import { Check, ChevronDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { activeOrganization, initialOf, type SignedInAuth } from "@/auth/auth-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { env } from "@/config/env";
import { THEME_PREFERENCES, type ThemePreference } from "@/theme/use-theme";
import { APP_VERSION } from "@/version";

interface SettingsViewProps {
  readonly endpoint: DaemonEndpoint | null;
  readonly state: ConnectionState;
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly auth: SignedInAuth;
  readonly onSignOut: () => void;
  readonly onSetActiveOrganization: (organizationId: string) => void;
}

const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

export function SettingsView({
  endpoint,
  state,
  theme,
  onSetTheme,
  auth,
  onSignOut,
  onSetActiveOrganization,
}: SettingsViewProps) {
  const CurrentThemeIcon = THEME_ICON[theme];

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
      <Section
        title="Account"
        description="The account this Concors is signed in with. Cloud machines and billing belong to its organization."
      >
        <AccountRows
          auth={auth}
          onSignOut={onSignOut}
          onSetActiveOrganization={onSetActiveOrganization}
        />
      </Section>

      <Section title="Appearance" description="How Concors looks on this device.">
        <Row label="Theme" hint="Follow the system or pick one explicitly.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-28 justify-between">
                <span className="flex items-center gap-2">
                  <CurrentThemeIcon aria-hidden="true" />
                  {THEME_LABEL[theme]}
                </span>
                <ChevronDown className="opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              {THEME_PREFERENCES.map((option) => {
                const Icon = THEME_ICON[option];
                return (
                  <DropdownMenuItem key={option} onSelect={() => onSetTheme(option)}>
                    <Icon aria-hidden="true" />
                    {THEME_LABEL[option]}
                    {option === theme && <Check className="ml-auto" aria-hidden="true" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      </Section>

      <Section
        title="Daemon"
        description="The Concors daemon runs your agents. It can live on this machine or on a remote server."
      >
        <Row label="Endpoint">
          <span className="flex items-center gap-2">
            <Mono>{endpoint?.url ?? "resolving…"}</Mono>
            {endpoint !== null && (
              <Badge variant="outline" className="tracking-wide uppercase">
                {endpoint.kind}
              </Badge>
            )}
          </span>
        </Row>
        <Row label="Status">
          <span className="capitalize">{state.status.replace("_", " ")}</span>
        </Row>
        <Row label="Daemon version">
          <Mono>{state.status === "ready" ? state.daemon.daemonVersion : "—"}</Mono>
        </Row>
        <Row label="Protocol" hint="Version negotiated with the daemon.">
          <Mono>{state.status === "ready" ? state.daemon.protocolVersion : PROTOCOL_VERSION}</Mono>
        </Row>
      </Section>

      <Section title="About">
        <Row label="Client version">
          <Mono>{APP_VERSION}</Mono>
        </Row>
        <Row
          label="Concors API"
          hint="Control plane for accounts, organizations and cloud machines."
        >
          <Mono>{env.apiUrl}</Mono>
        </Row>
      </Section>
    </div>
  );
}

function AccountRows({
  auth,
  onSignOut,
  onSetActiveOrganization,
}: Pick<SettingsViewProps, "auth" | "onSignOut" | "onSetActiveOrganization">) {
  const org = activeOrganization(auth);
  return (
    <>
      <Row label="Signed in as">
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {initialOf(auth.user)}
          </span>
          <span className="text-foreground">{auth.user.name}</span>
        </span>
      </Row>
      <Row label="Email">
        <span className="flex items-center gap-2">
          {auth.user.email}
          {!auth.user.emailVerified && (
            <Badge variant="outline" className="tracking-wide uppercase">
              Unverified
            </Badge>
          )}
        </span>
      </Row>
      <Row label="Organization" hint="Cloud machines and billing belong to an organization.">
        {auth.organizations.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="max-w-56 justify-between">
                <span className="truncate">{org?.name ?? "Choose…"}</span>
                <ChevronDown className="opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {auth.organizations.map((candidate) => (
                <DropdownMenuItem
                  key={candidate.id}
                  onSelect={() => onSetActiveOrganization(candidate.id)}
                >
                  <span className="truncate">{candidate.name}</span>
                  {candidate.isPersonal && (
                    <span className="text-xs text-muted-foreground">· personal</span>
                  )}
                  {candidate.id === org?.id && <Check className="ml-auto" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span>{org?.name ?? "—"}</span>
        )}
      </Row>
      <Row label="Session" hint="Sessions last 30 days and renew while you use Concors.">
        <span>Expires {formatDate(auth.session.expiresAt)}</span>
      </Row>
      <div className="py-2.5">
        <Button variant="outline" size="sm" onClick={onSignOut}>
          <LogOut data-icon="inline-start" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      <Separator className="my-4" />
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="selectable min-w-0 shrink-0 text-muted-foreground">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}
