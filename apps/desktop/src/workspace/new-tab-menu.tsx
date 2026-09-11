import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
import { PaneProfileIcon } from "./profile-icon";
import { paneProfiles } from "./tab-profiles";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { useContext, useRef, useState, type ReactNode } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Plus, Settings2 } from "lucide-react";
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
  empty = false,
  keyboard = false,
  tabLimitReached = false,
  renderTrigger,
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, terminalProfileId?: string) => void;
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
  useCommand("new-tab", keyboard && !disabled, () => {
    setOpen(true);
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
                {paneProfiles(profiles.profiles)
                  .sort((a, b) => Number(b.profile === "chat") - Number(a.profile === "chat"))
                  .map(({ id, profile, label, terminalProfileId }) => (
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
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    profiles.openSettings(true);
                  }}
                >
                  <span className="mobile-session-icon">
                    <Plus />
                  </span>
                  <span>Add terminal profile…</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    profiles.openSettings();
                  }}
                >
                  <span className="mobile-session-icon">
                    <Settings2 />
                  </span>
                  <span>Manage terminal profiles…</span>
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            title={`New tab (${shortcutLabel("new-tab")})`}
            aria-label={empty ? "Create a tab" : "New tab"}
            disabled={disabled}
            className={
              empty
                ? "flex items-center gap-2 rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
                : "shrink-0 rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
            }
          >
            <Plus className="size-4" />
            {empty && "Create a tab"}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72 max-w-[calc(100vw-16px)]"
            onCloseAutoFocus={(event) => {
              // The selected pane or settings page owns focus after selection.
              if (menuTransfersFocus.current) event.preventDefault();
              menuTransfersFocus.current = false;
            }}
          >
            {paneProfiles(profiles.profiles).map(
              ({ id, profile, label, icon: Icon, terminalProfileId }) => (
                <DropdownMenuItem
                  key={id}
                  disabled={disabled}
                  onSelect={() => {
                    menuTransfersFocus.current = true;
                    create(profile, terminalProfileId);
                  }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </DropdownMenuItem>
              ),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={() => {
                menuTransfersFocus.current = true;
                profiles.openSettings(true);
              }}
            >
              <Plus /> Add terminal profile…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={() => {
                menuTransfersFocus.current = true;
                profiles.openSettings();
              }}
            >
              <Settings2 /> Manage terminal profiles…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
