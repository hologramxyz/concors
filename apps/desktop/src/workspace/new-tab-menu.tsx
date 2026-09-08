import { useState } from "react";
import { Bot, MessageSquare, Plus, SlidersHorizontal, Terminal } from "lucide-react";
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

export const TAB_PROFILES: { profile: PaneProfile; label: string; icon: typeof Terminal }[] = [
  { profile: "shell", label: "Terminal", icon: Terminal },
  { profile: "chat", label: "Unified chat", icon: MessageSquare },
  { profile: "codex", label: "Codex", icon: Bot },
  { profile: "claude", label: "Claude Code", icon: Bot },
  { profile: "opencode", label: "OpenCode", icon: Bot },
];

export function NewTabMenu({
  disabled,
  onCreate,
  empty = false,
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, name?: string) => void;
  empty?: boolean;
}) {
  const [configuring, setConfiguring] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
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
            <DropdownMenuItem key={profile} disabled={disabled} onSelect={() => onCreate(profile)}>
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
