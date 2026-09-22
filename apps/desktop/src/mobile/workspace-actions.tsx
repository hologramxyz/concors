import { useState } from "react";
import { useCommand } from "@/shortcuts/context";
import { Ellipsis, Pencil, X } from "lucide-react";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { FormDialog } from "@/workspace/form-dialog";
import { Button } from "@/components/ui/button";
import { paneProfiles } from "@/workspace/tab-profiles";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { tabPanes, type PaneNode } from "./selection";

export function WorkspaceActions({
  project,
  tab,
  pane,
  canEdit,
  execute,
  command,
  onSelect,
  selected = false,
  label,
  keyboard = false,
  showTrigger = true,
  onComplete,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  pane: PaneNode;
  canEdit: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
  selected?: boolean;
  label: string;
  keyboard?: boolean;
  showTrigger?: boolean;
  onComplete?(): void;
}) {
  const profiles = useTerminalProfiles();
  const options = paneProfiles(profiles.profiles);
  const [rename, setRename] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: pane.id,
  };
  // Both shortcut spellings close only the visible leaf on mobile, never its siblings.
  useCommand("close-pane", canEdit && keyboard, () => setClosing(true));
  useCommand("close-tab", canEdit && keyboard, () => setClosing(true));
  return (
    <>
      {showTrigger && (
        <DropdownMenu>
          <DropdownMenuTrigger className="mobile-icon mobile-row-actions" aria-label={label}>
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Only desktop tabs have saved names. Do not rename split siblings together. */}
            {tabPanes(tab).length === 1 && (
              <DropdownMenuItem disabled={!canEdit} onSelect={() => setRename(true)}>
                <Pencil />
                Rename tab
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing(true)}>
              <X />
              Close tab…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tab type</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={pane.terminalProfile?.id ?? pane.profile}
              onValueChange={(id) => {
                const option = options.find((item) => item.id === id);
                if (option)
                  command({
                    kind: "pane.configure",
                    ...target,
                    profile: option.profile,
                    ...(profiles.supported && option.terminalProfileId
                      ? { terminalProfileId: option.terminalProfileId }
                      : {}),
                  });
              }}
            >
              {options.map(({ id, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={id} value={id} disabled={!canEdit}>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error && (
        <Dialog open onOpenChange={() => setError(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Workspace action failed</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      {rename && (
        <FormDialog
          title="Rename tab"
          description="The name updates on every connected client."
          fields={[{ name: "name", label: "Tab name", value: tab.name }]}
          onClose={() => setRename(false)}
          onSubmit={(values) =>
            execute({
              kind: "tab.rename",
              projectId: project.id,
              expectedVersion: project.version,
              tabId: tab.id,
              name: values["name"] ?? "",
            }).then(() => onComplete?.())
          }
        />
      )}
      <Dialog
        open={closing}
        onOpenChange={(open) => {
          if (!open && !busy) setClosing(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close tab?</DialogTitle>
            <DialogDescription>
              This closes this session’s pane on every connected device. Other panes stay open.
              {tabPanes(tab).length === 1 && " Its empty desktop tab is also removed."} Machine
              processes remain governed by the daemon's session lifecycle.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit || busy}
              onClick={() => {
                setBusy(true);
                void execute({ kind: "pane.close", ...target })
                  .then(() => {
                    setClosing(false);
                    if (selected) onSelect({ projectId: project.id, tabId: tab.id });
                    onComplete?.();
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not close"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Close tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
