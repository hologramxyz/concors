import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import { PROTOCOL_VERSION } from "@concors/protocol";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

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
}

const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

export function SettingsView({ endpoint, state, theme, onSetTheme }: SettingsViewProps) {
  const CurrentThemeIcon = THEME_ICON[theme];

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
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
          hint="Control plane used for accounts and remote daemons (not yet in use)."
        >
          <Mono>{env.apiUrl}</Mono>
        </Row>
      </Section>
    </div>
  );
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
