import { useCommand } from "@/shortcuts/context";
import { useShortcutLabels } from "@/shortcuts/preferences-context";
import { PaneProfileIcon } from "./profile-icon";
import { paneProfiles } from "./tab-profiles";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { Fragment, useContext, useRef, useState, type ReactNode } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ChevronDown, History, Plus } from "lucide-react";
import { cn } from "cn";
import type { PaneProfile } from "@concors/protocol";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function NewTabMenu({
  disabled,
  onCreate,
  onResume,
  empty = false,
  keyboard = false,
  tabLimitReached = false,
  renderTrigger,
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, terminalProfileId?: string) => void;
  /** Offers the closed chats of this workspace next to the new ones. */
  onResume?: () => void;
  empty?: boolean;
  keyboard?: boolean;
  tabLimitReached?: boolean;
  renderTrigger?: (open: () => void) => ReactNode;
}) {
  const compact = useContext(CompactLayoutContext);
  const shortcutLabel = useShortcutLabels();
  const profiles = useTerminalProfiles();
  const triggerContainer = useRef<HTMLSpanElement>(null);
  const menuTransfersFocus = useRef(false);
  const createDisabled = disabled || tabLimitReached;
  const create = (profile: PaneProfile, terminalProfileId?: string) => {
    const id = profiles.supported ? terminalProfileId : undefined;
    onCreate(profile, id);
  };
  const [open, setOpen] = useState(false);
  // Like "+", the shortcut opens a tab on the start screen; small screens still choose first.
  useCommand("new-tab", keyboard && !disabled, () => {
    if (compact) setOpen(true);
    else if (!createDisabled) create("chat");
  });
  const restoreTriggerFocus = (event: Event) => {
    if (!compact || !renderTrigger) return;
    event.preventDefault();
    requestAnimationFrame(() => {
      if (!document.querySelector('[data-slot="dialog-content"][data-state="open"]'))
        triggerContainer.current?.querySelector("button")?.focus({ preventScroll: true });
    });
  };
  return (
    <>
      {compact ? (
        <>
          {renderTrigger ? (
            <span ref={triggerContainer} className="contents">
              {renderTrigger(() => setOpen(true))}
            </span>
          ) : (
            <button
              className={empty ? "mobile-new-empty" : "mobile-icon"}
              aria-label={empty ? "Create a tab" : "New tab"}
              disabled={disabled}
              onClick={() => {
                setOpen(true);
              }}
            >
              <Plus className="size-5" />
              {empty && "Create a tab"}
            </button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent onCloseAutoFocus={restoreTriggerFocus}>
              <DialogHeader>
                <DialogTitle>New tab</DialogTitle>
                <DialogDescription>
                  Start a chat or terminal, synced with your desktop.
                </DialogDescription>
              </DialogHeader>
              {createDisabled && !disabled && (
                <p role="status" className="text-sm text-muted-foreground">
                  This project has reached its 32-tab limit.
                </p>
              )}
              <div className="mobile-session-list">
                {paneProfiles(profiles.profiles).map(
                  ({ id, profile, label, terminalProfileId }) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={label}
                      disabled={createDisabled}
                      onClick={() => {
                        setOpen(false);
                        create(profile, terminalProfileId);
                      }}
                    >
                      <span className="mobile-session-icon">
                        <PaneProfileIcon profile={profile} />
                      </span>
                      <span>
                        <span className="block font-medium">{label}</span>
                        <span className="mobile-select-description">
                          {profile === "chat"
                            ? "Chat with an agent, review tools and approve work"
                            : profile === "shell"
                              ? "Run commands on your machine"
                              : `Open ${label} in an interactive terminal`}
                        </span>
                      </span>
                    </button>
                  ),
                )}
                {onResume && (
                  <button
                    type="button"
                    aria-label="Resume a closed chat"
                    disabled={createDisabled}
                    onClick={() => {
                      setOpen(false);
                      onResume();
                    }}
                  >
                    <span className="mobile-session-icon">
                      <History className="size-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-medium">Resume a closed chat</span>
                      <span className="mobile-select-description">
                        Reopen a chat with its name, settings and history
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        // A split button: "+" opens a new tab on the start screen, and the ⌄ beside it lists every
        // way to start one.
        <div
          data-tour-frame
          className={cn("flex shrink-0 items-center", empty && "rounded-md border")}
        >
          <button
            type="button"
            title={`New tab (${shortcutLabel("new-tab")})`}
            aria-label={empty ? "Create a tab" : "New tab"}
            disabled={createDisabled}
            onClick={() => create("chat")}
            className={
              empty
                ? "flex items-center gap-2 rounded-l-md px-3 py-1.5 hover:bg-muted disabled:opacity-40"
                : "rounded-l p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            }
          >
            <Plus className="size-4" />
            {empty && "Create a tab"}
          </button>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger
              data-tour="new-tab"
              title="New tab options"
              aria-label="New tab options"
              disabled={disabled}
              className={
                empty
                  ? "self-stretch rounded-r-md border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  : "self-stretch rounded-r px-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 data-[state=open]:bg-muted"
              }
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-72 max-w-[calc(100vw-16px)]"
              // Near the window's right edge the menu would sit flush with it, and its border
              // (a ring drawn just outside the box) would fall off the window.
              collisionPadding={8}
              onCloseAutoFocus={(event) => {
                // The selected pane owns focus after selection.
                if (menuTransfersFocus.current) event.preventDefault();
                menuTransfersFocus.current = false;
              }}
            >
              {paneProfiles(profiles.profiles).map(
                ({ id, profile, label, icon: Icon, terminalProfileId }) => (
                  <Fragment key={id}>
                    <DropdownMenuItem
                      disabled={disabled}
                      onSelect={() => {
                        menuTransfersFocus.current = true;
                        create(profile, terminalProfileId);
                      }}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </DropdownMenuItem>
                    {profile === "chat" && <DropdownMenuSeparator />}
                  </Fragment>
                ),
              )}
              {onResume && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={createDisabled}
                    onSelect={() => {
                      menuTransfersFocus.current = true;
                      onResume();
                    }}
                  >
                    <History className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Resume a chat…</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  );
}
