import { ChevronsUpDown, LogOut, Plus, UserRound, Settings } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  readonly collapsed?: boolean;
}

/** Sidebar footer: who is signed in, with settings and sign out. */
export function AccountMenu({
  auth,
  onSignOut,
  onOpenSettings,
  collapsed = false,
}: AccountMenuProps) {
  const compact = useContext(CompactLayoutContext);
  if (compact)
    return <MobileAccountMenu auth={auth} onSignOut={onSignOut} onOpenSettings={onOpenSettings} />;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={`flex items-center rounded-md hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent ${collapsed ? "sidebar-rail-control" : "h-9 w-full gap-2 px-2 text-left"}`}
            aria-label={`Account: ${auth.user.name}`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-4xl bg-primary text-xs font-semibold text-primary-foreground">
              {initialOf(auth.user)}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{auth.user.name}</span>
                </span>
                <ChevronsUpDown
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? "right" : "top"} sideOffset={6}>
          {auth.user.name} · Account and settings
        </TooltipContent>
      </Tooltip>
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

export function MobileAccountMenu({
  auth,
  onSignOut,
  onOpenSettings,
  machinePicker,
  onAddMachine,
  profile,
  onOpenProfile,
}: Omit<AccountMenuProps, "auth"> & {
  auth: SignedInAuth | null;
  machinePicker?: ReactNode;
  onAddMachine?: () => void;
  profile?: { name: string; email: string } | null;
  onOpenProfile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const person = auth?.user ?? profile;
  const name = person?.name || person?.email || "Your profile";
  const avatar = person ? (
    (person.name.trim() || person.email)[0]?.toUpperCase()
  ) : (
    <UserRound className="size-4" aria-hidden="true" />
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="mobile-account-trigger" aria-label={`Account: ${name}`}>
        <span className="mobile-account-avatar">{avatar}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="mobile-account-drawer">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a machine, manage settings or disconnect.
          </DialogDescription>
        </DialogHeader>
        {machinePicker && <div className="mobile-account-machine">{machinePicker}</div>}
        <div className="mobile-account-identity">
          <span className="mobile-account-avatar">{avatar}</span>
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {person ? person.email : "Sign in to your Concourse account"}
            </p>
          </div>
        </div>
        <div className="mobile-account-actions">
          {onOpenProfile && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
            >
              <UserRound aria-hidden="true" />
              {person ? "Your profile" : "Sign in"}
            </button>
          )}
          {onAddMachine && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddMachine();
              }}
            >
              <Plus aria-hidden="true" />
              Add machine
            </button>
          )}
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
            {auth ? "Sign out" : "Disconnect desktop"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
