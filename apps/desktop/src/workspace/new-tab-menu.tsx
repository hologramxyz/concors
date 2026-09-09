import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
import { PaneProfileIcon } from "./profile-icon";
import { TAB_PROFILES } from "./tab-profiles";
import { useContext, useRef, useState, type ReactNode } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Plus, SlidersHorizontal } from "lucide-react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewTabMenu({
  disabled,
  onCreate,
  empty = false,
  keyboard = false,
  paneTarget,
  tabLimitReached = false,
  renderTrigger,
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, name?: string) => void;
  empty?: boolean;
  keyboard?: boolean;
  tabLimitReached?: boolean;
  renderTrigger?: (open: (destination?: "tab" | "pane") => void) => ReactNode;
  paneTarget?:
    { name: string; disabled: boolean; onCreate(profile: PaneProfile): void } | undefined;
}) {
  const compact = useContext(CompactLayoutContext);
  const triggerContainer = useRef<HTMLSpanElement>(null);
  const [destination, setDestination] = useState<"tab" | "pane">("tab");
  const addingPane = compact && destination === "pane" && !!paneTarget;
  const createDisabled = disabled || (addingPane ? paneTarget.disabled : tabLimitReached);
  const create = (profile: PaneProfile, name?: string) => {
    if (addingPane) paneTarget.onCreate(profile);
    else onCreate(profile, name);
  };
  const [open, setOpen] = useState(false);
  useCommand("new-tab", keyboard && !disabled, () => {
    setDestination("tab");
    setOpen(true);
  });
  const [configuring, setConfiguring] = useState(false);
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
              {renderTrigger((destination = "tab") => {
                setDestination(destination);
                setOpen(true);
              })}
            </span>
          ) : (
            <button
              className={empty ? "mobile-new-empty" : "mobile-icon"}
              aria-label={empty ? "Create a tab" : "New tab"}
              disabled={disabled}
              onClick={() => {
                setDestination("tab");
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
                <DialogTitle>{addingPane ? "Add pane" : "New tab"}</DialogTitle>
                <DialogDescription>
                  {addingPane
                    ? `Add a session inside “${paneTarget.name}”. Mobile shows one pane at a time; desktop adds it beside the current pane.`
                    : "Create a separate tab with its first chat or terminal pane."}
                </DialogDescription>
              </DialogHeader>
              {paneTarget && (
                <div
                  className="mobile-session-destination"
                  role="group"
                  aria-label="Create in workspace"
                >
                  <button
                    type="button"
                    aria-pressed={!addingPane}
                    onClick={() => setDestination("tab")}
                  >
                    New tab
                  </button>
                  <button
                    type="button"
                    aria-pressed={addingPane}
                    onClick={() => setDestination("pane")}
                  >
                    Add pane to this tab
                  </button>
                </div>
              )}
              {createDisabled && !disabled && (
                <p role="status" className="text-sm text-muted-foreground">
                  {addingPane
                    ? "This tab has reached its 32-pane limit."
                    : "This project has reached its 32-tab limit."}
                </p>
              )}
              <div className="mobile-session-list">
                {[...TAB_PROFILES]
                  .sort((a, b) => Number(b.profile === "chat") - Number(a.profile === "chat"))
                  .map(({ profile, label }) => (
                    <button
                      key={profile}
                      type="button"
                      aria-label={label}
                      disabled={createDisabled}
                      onClick={() => {
                        setOpen(false);
                        create(profile);
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
                {!addingPane && (
                  <button
                    type="button"
                    disabled={createDisabled}
                    onClick={() => {
                      setOpen(false);
                      setConfiguring(true);
                    }}
                  >
                    <span className="mobile-session-icon">
                      <SlidersHorizontal />
                    </span>
                    <span>Configure terminal profile…</span>
                  </button>
                )}
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
          <DropdownMenuContent className="w-64">
            {TAB_PROFILES.map(({ profile, label, icon: Icon }) => (
              <DropdownMenuItem
                key={profile}
                disabled={disabled}
                onSelect={() => onCreate(profile)}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="whitespace-nowrap"
              disabled={disabled}
              onSelect={() => setConfiguring(true)}
            >
              <SlidersHorizontal /> Configure terminal profile…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={configuring} onOpenChange={setConfiguring}>
        <DialogContent onCloseAutoFocus={restoreTriggerFocus}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              onCreate(data.get("profile") as PaneProfile, String(data.get("name")).trim());
              setConfiguring(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Configure terminal profile</DialogTitle>
              <DialogDescription>
                Choose a profile and name for this tab. It starts in the project folder.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 space-y-4">
              <label className="block space-y-2">
                <span>Tab name</span>
                <Input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Development terminal"
                  disabled={disabled}
                />
              </label>
              <label className="block space-y-2">
                <span>Terminal profile</span>
                <select
                  aria-label="Terminal profile"
                  name="profile"
                  defaultValue="shell"
                  disabled={disabled}
                  className="h-9 w-full rounded-md border bg-background px-2"
                >
                  {TAB_PROFILES.filter(({ profile }) => profile !== "chat").map(
                    ({ profile, label }) => (
                      <option key={profile} value={profile}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfiguring(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled}>
                Start session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
