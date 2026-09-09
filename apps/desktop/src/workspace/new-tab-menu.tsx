import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
import { TAB_PROFILES } from "./tab-profiles";
import { useContext, useState } from "react";
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
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, name?: string) => void;
  empty?: boolean;
  keyboard?: boolean;
}) {
  const compact = useContext(CompactLayoutContext);
  const [open, setOpen] = useState(false);
  useCommand("new-tab", keyboard && !disabled, () => setOpen(true));
  const [configuring, setConfiguring] = useState(false);
  return (
    <>
      {compact ? (
        <>
          <button
            className={empty ? "mobile-new-empty" : "mobile-icon"}
            aria-label={empty ? "Create a tab" : "New tab"}
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            <Plus className="size-5" />
            {empty && "Create a tab"}
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New tab</DialogTitle>
                <DialogDescription>
                  Start an agent conversation or a terminal in this project.
                </DialogDescription>
              </DialogHeader>
              <div className="mobile-session-list">
                {[...TAB_PROFILES]
                  .sort((a, b) => Number(b.profile === "chat") - Number(a.profile === "chat"))
                  .map(({ profile, label, icon: Icon }) => (
                    <button
                      key={profile}
                      type="button"
                      aria-label={label}
                      disabled={disabled}
                      onClick={() => {
                        setOpen(false);
                        onCreate(profile);
                      }}
                    >
                      <span className="mobile-session-icon">
                        <Icon />
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
                  disabled={disabled}
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
          <DropdownMenuContent className="w-52">
            {TAB_PROFILES.map(({ profile, label, icon: Icon }) => (
              <DropdownMenuItem
                key={profile}
                disabled={disabled}
                onSelect={() => onCreate(profile)}
              >
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={disabled} onSelect={() => setConfiguring(true)}>
              <SlidersHorizontal /> Configure terminal profile…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={configuring} onOpenChange={setConfiguring}>
        <DialogContent>
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
