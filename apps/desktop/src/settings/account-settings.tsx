import { Check, ChevronDown, LogOut } from "lucide-react";

import { activeOrganization, initialOf, type SignedInAuth } from "@/auth/auth-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format-date";
import { Row, Section } from "@/views/settings-primitives";

interface AccountSettingsProps {
  readonly auth: SignedInAuth;
  readonly onSignOut: () => void;
  readonly onSetActiveOrganization: (organizationId: string) => void;
}

export function AccountSettings({
  auth,
  onSignOut,
  onSetActiveOrganization,
}: AccountSettingsProps) {
  const organization = activeOrganization(auth);

  return (
    <>
      <Section
        title="Profile"
        description="The personal details associated with your Concors account."
      >
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
      </Section>

      <Section
        title="Organization"
        description="Cloud machines and billing belong to the active organization."
      >
        <Row label="Active organization">
          {auth.organizations.length > 1 ? (
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
            <span>{organization?.name ?? "—"}</span>
          )}
        </Row>
      </Section>

      <Section title="Session" description="Sessions last 30 days and renew while you use Concors.">
        <Row label="Expires">
          <span>{formatDate(auth.session.expiresAt)}</span>
        </Row>
        <div className="py-2.5">
          <Button variant="outline" size="sm" onClick={onSignOut}>
            <LogOut data-icon="inline-start" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </Section>
    </>
  );
}
