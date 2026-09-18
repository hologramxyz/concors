import { AccountAvatar } from "@/components/account-avatar";
import { useGitHub } from "@/github/use-github";
import { GitHubConnection } from "@/github/connection";
import { Check, ChevronDown } from "lucide-react";
import { useContext } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Section } from "@/views/settings-primitives";

import { MobileOrganizationPicker } from "@/mobile/organization-picker";

interface AccountSettingsProps {
  readonly auth: SignedInAuth;
  readonly onSetActiveOrganization: (organizationId: string) => unknown;
}

export function AccountSettings({ auth, onSetActiveOrganization }: AccountSettingsProps) {
  const github = useGitHub();
  const organization = activeOrganization(auth);
  const compact = useContext(CompactLayoutContext);

  return (
    <>
      <Section title="Profile" description="Your identity across Concors.">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border p-4">
          <AccountAvatar user={auth.user} githubEnabled className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{auth.user.name}</p>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 [overflow-wrap:anywhere]">{auth.user.email}</span>
              {!auth.user.emailVerified && (
                <Badge variant="outline" className="shrink-0 tracking-wide uppercase">
                  Unverified
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Integrations" description="Connect services to your Concors account.">
        <GitHubConnection github={github} />
      </Section>

      <Section
        title="Organization"
        description="Machines, access, and billing are scoped to the active organization."
      >
        <div className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Active organization</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              New cloud machines will belong to this organization.
            </p>
          </div>
          <div className="min-w-0 md:max-w-[50%]">
            {compact ? (
              <MobileOrganizationPicker auth={auth} onSelect={onSetActiveOrganization} />
            ) : auth.organizations.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="max-w-56 justify-between">
                    <span className="truncate">{organization?.name ?? "Choose…"}</span>
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
                      {candidate.id === organization?.id && (
                        <Check className="ml-auto" aria-hidden="true" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="flex max-w-full items-center gap-2 text-sm font-medium text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {organization?.name ?? "—"}
                </span>
                {organization?.isPersonal && (
                  <Badge variant="outline" className="shrink-0 font-normal">
                    Personal
                  </Badge>
                )}
              </span>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
