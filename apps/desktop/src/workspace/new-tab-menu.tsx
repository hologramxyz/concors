import { useCommand } from "@/shortcuts/context";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { MenuKeyChips } from "@/shortcuts/key-chips";
import { RowMenuGroup, RowMenuSeparator } from "@/components/row-menu-sheet";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
        // A trigger made of several buttons (the phone's tab strip) marks the one that opens it.
        (
          triggerContainer.current?.querySelector<HTMLElement>("[data-new-tab-trigger]") ??
          triggerContainer.current?.querySelector("button")
        )?.focus({ preventScroll: true });
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
            {/* Desktop's "+" menu as a sheet: the chat, then everything that runs in a terminal,
                each under the label the phone's other sheets use, then resuming one. */}
            <DialogContent
              className="mobile-select-sheet mobile-row-sheet"
              aria-describedby={undefined}
              onCloseAutoFocus={restoreTriggerFocus}
            >
              <DialogHeader>
                <DialogTitle>New tab</DialogTitle>
              </DialogHeader>
              {createDisabled && !disabled && (
                <p role="status" className="text-sm text-muted-foreground">
                  This project has reached its 32-tab limit.
                </p>
              )}
              <div className="mobile-select-sheet-list">
                {(["Chat", "In a terminal"] as const).map((group) => (
                  <RowMenuGroup key={group} label={group}>
                    {paneProfiles(profiles.profiles)
                      .filter((item) => (item.profile === "chat") === (group === "Chat"))
                      .map(({ id, profile, label, icon: Icon, terminalProfileId }) => (
                        <button
                          key={id}
                          type="button"
                          aria-label={label}
                          disabled={createDisabled}
                          className="mobile-select-option disabled:opacity-50"
                          onClick={() => {
                            setOpen(false);
                            create(profile, terminalProfileId);
                          }}
                        >
                          <span className="mobile-select-icon">
                            <Icon aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                      ))}
                  </RowMenuGroup>
                ))}
                {onResume && (
                  <>
                    <RowMenuSeparator />
                    <button
                      type="button"
                      aria-label="Resume a chat…"
                      disabled={createDisabled}
                      className="mobile-select-option disabled:opacity-50"
                      onClick={() => {
                        setOpen(false);
                        onResume();
                      }}
                    >
                      <span className="mobile-select-icon">
                        <History aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">Resume a chat…</span>
                    </button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        // A split button: "+" opens a new tab on the start screen, and the ⌄ beside it lists every
        // way to start one.
        <div className={cn("flex shrink-0 items-center", empty && "rounded-md border")}>
          <SidebarTooltip place="title-bar" content="New tab" shortcut="new-tab">
            <button
              type="button"
              aria-label={empty ? "Create a tab" : "New tab"}
              data-steady-while-creating
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
          </SidebarTooltip>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <SidebarTooltip place="title-bar" content="New tab options">
              <DropdownMenuTrigger
                aria-label="New tab options"
                data-steady-while-creating
                disabled={disabled}
                className={
                  empty
                    ? "self-stretch rounded-r-md border-l px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    : "self-stretch rounded-r px-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 data-[state=open]:bg-muted"
                }
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </DropdownMenuTrigger>
            </SidebarTooltip>
            <DropdownMenuContent
              className="w-max max-w-[min(24rem,calc(100vw-16px))] min-w-72"
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
                      {profile === "chat" && <MenuKeyChips id="new-tab" />}
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
                    <MenuKeyChips id="resume-chat" />
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
