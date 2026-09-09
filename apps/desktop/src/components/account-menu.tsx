import { ChevronsUpDown, Keyboard, LogOut, Settings } from "lucide-react";

import { activeOrganization, initialOf, type SignedInAuth } from "@/auth/auth-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AccountMenuProps {
  readonly auth: SignedInAuth;
  readonly onSignOut: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenShortcuts: () => void;
}

/** Sidebar footer: who is signed in, with settings, shortcuts, and sign out. */
export function AccountMenu({
  auth,
  onSignOut,
  onOpenSettings,
  onOpenShortcuts,
}: AccountMenuProps) {
  const org = activeOrganization(auth);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
        aria-label={`Account: ${auth.user.name}`}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-4xl bg-primary text-xs font-semibold text-primary-foreground">
          {initialOf(auth.user)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium">{auth.user.name}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-ui font-normal text-muted-foreground">
          {org ? (org.isPersonal ? "Personal organization" : org.name) : "Signed in"}
          <span className="mt-1 block truncate text-foreground">{auth.user.name}</span>
          <span className="block truncate" title={auth.user.email}>
            {auth.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-ui" onSelect={onOpenSettings}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem className="text-ui" onSelect={onOpenShortcuts}>
          <Keyboard aria-hidden="true" />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem className="text-ui" onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
