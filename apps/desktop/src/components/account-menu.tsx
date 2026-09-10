import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { useContext, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { initialOf, type SignedInAuth } from "@/auth/auth-state";
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
}

/** Sidebar footer: who is signed in, with settings and sign out. */
export function AccountMenu({ auth, onSignOut, onOpenSettings }: AccountMenuProps) {
  const compact = useContext(CompactLayoutContext);
  if (compact)
    return <MobileAccountMenu auth={auth} onSignOut={onSignOut} onOpenSettings={onOpenSettings} />;
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
          <span className="block truncate text-foreground">{auth.user.name}</span>
          <span className="block truncate" title={auth.user.email}>
            {auth.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-ui" onSelect={onOpenSettings}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem className="text-ui" onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileAccountMenu({ auth, onSignOut, onOpenSettings }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="mobile-account-trigger" aria-label={`Account: ${auth.user.name}`}>
        <span className="mobile-account-avatar">{initialOf(auth.user)}</span>
        <span className="min-w-0 flex-1 truncate">{auth.user.name}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="mobile-account-drawer">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your account settings or sign out.
          </DialogDescription>
        </DialogHeader>
        <div className="mobile-account-identity">
          <span className="mobile-account-avatar">{initialOf(auth.user)}</span>
          <div className="min-w-0">
            <p className="truncate font-medium">{auth.user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{auth.user.email}</p>
          </div>
        </div>
        <div className="mobile-account-actions">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <Settings aria-hidden="true" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
