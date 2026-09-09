import { useState } from "react";
import { useCommand } from "@/shortcuts/context";
import { Ellipsis, Pencil, X } from "lucide-react";
import type {
  PaneProfile,
  WorkspaceOperation,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";
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
import { PaneProfileIcon } from "@/workspace/profile-icon";
import { PROFILE_LABELS, tabPanes, type PaneNode } from "./selection";

export function WorkspaceActions({
  project,
  tab,
  pane,
  canEdit,
  execute,
  command,
  onSelect,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  pane: PaneNode;
  canEdit: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
}) {
  const [rename, setRename] = useState(false);
  const [closing, setClosing] = useState<"pane" | "tab" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: pane.id,
  };
  useCommand("close-pane", canEdit, () => setClosing("pane"));
  useCommand("close-tab", canEdit, () => setClosing("tab"));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="mobile-icon" aria-label="Tab and pane actions">
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{tab.name}</DropdownMenuLabel>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setRename(true)}>
            <Pencil />
            Rename tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing("tab")}>
            <X />
            Close tab…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Current pane</DropdownMenuLabel>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing("pane")}>
            <X />
            Close pane…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Pane profile</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={pane.profile}
            onValueChange={(profile) =>
              command({ kind: "pane.configure", ...target, profile: profile as PaneProfile })
            }
          >
            {Object.entries(PROFILE_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} disabled={!canEdit}>
                <PaneProfileIcon profile={value as PaneProfile} />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
            })
          }
        />
      )}
      <Dialog
        open={!!closing}
        onOpenChange={(open) => {
          if (!open && !busy) setClosing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {closing}?</DialogTitle>
            <DialogDescription>
              {closing === "pane" &&
                tabPanes(tab).length === 1 &&
                "This is the tab’s last pane, so the tab will also close. "}
              This removes the saved {closing} on all connected devices. Machine processes remain
              governed by the daemon's session lifecycle.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit || busy}
              onClick={() => {
                setBusy(true);
                void execute(
                  closing === "tab"
                    ? {
                        kind: "tab.close",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: tab.id,
                      }
                    : { kind: "pane.close", ...target },
                )
                  .then(() => {
                    setClosing(null);
                    onSelect({
                      projectId: project.id,
                      ...(closing === "pane" ? { tabId: tab.id } : {}),
                    });
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not close"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Close {closing}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
