import { useState } from "react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { cn } from "cn";
import type { WorkspaceOperation, WorkspaceProject } from "@concors/protocol";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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

export function ProjectActions({
  project,
  canEdit,
  execute,
  renaming,
  onRename,
  onCloseAutoFocus,
}: {
  project: WorkspaceProject;
  canEdit: boolean;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  /** The row is editing the name in place of its button. */
  renaming: boolean;
  /** Absent when the workspace cannot be renamed right now; the item is then disabled. */
  onRename: (() => void) | undefined;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${project.name}`}
          className={cn(
            "rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-sidebar-foreground data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
            // Kept mounted while renaming so closing the menu can hand focus to the input.
            renaming && "invisible",
          )}
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
          <DropdownMenuItem disabled={!onRename} onSelect={() => onRename?.()}>
            <Pencil /> Rename workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canEdit}
            variant="destructive"
            onSelect={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            <Trash2 /> Close workspace…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!pending) setConfirming(open);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`cancel-remove-${project.id}`)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Close {project.name}?</DialogTitle>
            <DialogDescription>
              This closes the workspace and its tabs on all connected devices. Files and running
              sessions are kept.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              id={`cancel-remove-${project.id}`}
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit || pending}
              onClick={() => {
                setPending(true);
                setError(null);
                void execute({
                  kind: "project.remove",
                  projectId: project.id,
                  expectedVersion: project.version,
                })
                  .then(() => setConfirming(false))
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not close workspace"),
                  )
                  .finally(() => setPending(false));
              }}
            >
              {pending ? "Closing…" : "Close workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
