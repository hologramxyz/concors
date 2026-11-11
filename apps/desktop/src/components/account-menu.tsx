import { AccountAvatar } from "./account-avatar";
import { useAccountImage } from "./use-account-image";
import { MobileAppDialog } from "./mobile-app";
import {
  ChevronsUpDown,
  LogIn,
  LogOut,
  MapIcon,
  UserRound,
  Settings,
  Smartphone,
} from "lucide-react";
import { useContext, useRef, useState, type ReactNode } from "react";
import { useNativeSurface } from "@/components/native-surface";
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
import { MenuKeyChips } from "@/shortcuts/key-chips";
import { replayTour } from "@/tour/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AccountMenuProps {
  /** Null for a guest using this computer without an account. */
  readonly auth: SignedInAuth | null;
  readonly onSignOut: () => void;
  readonly onSignIn: () => void;
  readonly onOpenSettings: () => void;
  readonly collapsed?: boolean;
  /** The tour points at the live workspace, so it cannot run while that is not loaded. */
  readonly canTour?: boolean;
}

/** Sidebar footer: who is signed in, with settings and sign out, or the way to sign in. */
export function AccountMenu({
  auth,
  onSignOut,
  onSignIn,
  onOpenSettings,
  collapsed = false,
  canTour = true,
}: AccountMenuProps) {
  const compact = useContext(CompactLayoutContext);
  const [mobileAppOpen, setMobileAppOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (compact)
    return <MobileAccountMenu auth={auth} onSignOut={onSignOut} onOpenSettings={onOpenSettings} />;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          className={`flex items-center rounded-md hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent ${collapsed ? "sidebar-rail-control" : "w-full gap-2 p-[8px] text-left"}`}
          aria-label={
            auth ? `Account: ${auth.user.name}` : "Using this computer without an account"
          }
        >
          {auth ? (
            <AccountAvatar user={auth.user} githubEnabled />
          ) : (
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-ui font-medium">
                {auth ? auth.user.name : "This computer"}
              </span>
              <ChevronsUpDown
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-[calc(var(--sidebar-width)-16px)] max-w-[calc(100vw-16px)]"
          onCloseAutoFocus={(event) => {
            if (mobileAppOpen) event.preventDefault();
          }}
        >
          {auth && (
            <>
              <DropdownMenuLabel className="p-[8px] text-ui font-normal text-muted-foreground">
                <span className="block truncate text-foreground">{auth.user.name}</span>
                <span className="block truncate" title={auth.user.email}>
                  {auth.user.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem className="p-[8px] text-ui" onSelect={onOpenSettings}>
            <Settings aria-hidden="true" />
            Settings
            <MenuKeyChips id="settings" />
          </DropdownMenuItem>
          <DropdownMenuItem className="p-[8px] text-ui" disabled={!canTour} onSelect={replayTour}>
            <MapIcon aria-hidden="true" />
            Take the tour
          </DropdownMenuItem>
          <DropdownMenuItem className="p-[8px] text-ui" onSelect={() => setMobileAppOpen(true)}>
            <Smartphone aria-hidden="true" />
            Get the iOS app
          </DropdownMenuItem>
          <DropdownMenuItem className="p-[8px] text-ui" onSelect={auth ? onSignOut : onSignIn}>
            {auth ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />}
            {auth ? "Sign out" : "Sign in"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MobileAppDialog open={mobileAppOpen} onOpenChange={setMobileAppOpen} returnFocus={trigger} />
    </>
  );
}

export function MobileAccountMenu({
  auth,
  onSignOut,
  onOpenSettings,
  organizationPicker,
  profile,
  onOpenProfile,
}: Omit<AccountMenuProps, "auth" | "onSignIn"> & {
  auth: SignedInAuth | null;
  organizationPicker?: ReactNode;
  profile?: { name: string; email: string; image?: string | null } | null;
  onOpenProfile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const person = auth?.user ?? profile;
  const name = person?.name || person?.email || "Your profile";
  const { src } = useAccountImage(person, !!auth);
  const trigger = useRef<HTMLButtonElement>(null);
  const native = useNativeSurface(
    trigger,
    {
      kind: "button",
      icon: "account",
      title: name,
      label: `Account: ${name}`,
      mark: person ? initialOf(person) : undefined,
      avatarUrl: src?.startsWith("https://") && src.length <= 2048 ? src : undefined,
      disabled: false,
    },
    (event) => {
      if (event.kind === "press" && event.control === "activate") trigger.current?.click();
    },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        ref={trigger}
        className="mobile-account-trigger mobile-glass"
        aria-label={`Account: ${name}`}
        data-native-surface={native || undefined}
        aria-hidden={native || undefined}
        tabIndex={native ? -1 : undefined}
      >
        <AccountAvatar user={person} githubEnabled={!!auth} className="mobile-account-avatar" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="mobile-account-drawer">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an organization, manage settings or disconnect.
          </DialogDescription>
        </DialogHeader>
        <div className="mobile-account-identity">
          <AccountAvatar user={person} githubEnabled={!!auth} className="mobile-account-avatar" />
          <div className="min-w-0">
            <p className="truncate font-medium">{person ? name : "Not signed in"}</p>
            {person && <p className="truncate text-sm text-muted-foreground">{person.email}</p>}
          </div>
        </div>
        {organizationPicker}
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
