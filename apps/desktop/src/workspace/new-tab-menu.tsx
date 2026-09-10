import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
import { paneProfiles } from "./tab-profiles";
import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import type { PaneProfile } from "@concors/protocol";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function NewTabMenu({
  disabled,
  onCreate,
  empty = false,
  keyboard = false,
}: {
  disabled: boolean;
  onCreate: (profile: PaneProfile, name?: string, terminalProfileId?: string) => void;
  empty?: boolean;
  keyboard?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const profiles = useTerminalProfiles();
  useCommand("new-tab", keyboard && !disabled, () => setOpen(true));
  return (
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
      <DropdownMenuContent className="w-72 max-w-[calc(100vw-16px)]">
        {paneProfiles(profiles.profiles).map(
          ({ id, profile, label, icon: Icon, terminalProfileId }) => (
            <DropdownMenuItem
              key={id}
              disabled={disabled}
              onSelect={() =>
                onCreate(profile, label, profiles.supported ? terminalProfileId : undefined)
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </DropdownMenuItem>
          ),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="whitespace-nowrap"
          onSelect={() => profiles.openSettings(true)}
        >
          <Plus /> Add terminal profile…
        </DropdownMenuItem>
        <DropdownMenuItem className="whitespace-nowrap" onSelect={() => profiles.openSettings()}>
          <Settings2 /> Manage terminal profiles…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
