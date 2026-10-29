import { useContext, useState } from "react";
import { Ellipsis, FolderX, Pencil, Trash2 } from "lucide-react";
import { cn } from "cn";
import {
  PROJECT_CLOSE_CAPABILITY,
  type WorkspaceOperation,
  type WorkspaceProject,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
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
  // Closing keeps the workspace's chats and tabs for when its folder is opened again. Older daemons
  // can only remove it, so they keep the old wording and the destructive style.
  const connection = useContext(TerminalConnectionContext);
  const keeps =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PROJECT_CLOSE_CAPABILITY);
  // Shown in its tabs or running in the background, every one stops with the workspace.
  const running = useTerminalSessions().filter(
    (terminal) =>
      terminal.projectId === project.id &&
      (terminal.status === "running" || terminal.status === "starting"),
  ).length;
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
            variant={keeps ? "default" : "destructive"}
            onSelect={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {keeps ? <FolderX /> : <Trash2 />} Close workspace…
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
            <DialogTitle>
              {keeps ? `Close "${project.name}"?` : `Close ${project.name}?`}
            </DialogTitle>
            {keeps ? (
              <DialogDescription>
                Its chats are kept. Reopen it from the + menu.
                {running > 0 && (
                  <span className="mt-1 block">
                    {running === 1
                      ? "1 running terminal will be stopped."
                      : `${running} running terminals will be stopped.`}
                  </span>
                )}
              </DialogDescription>
            ) : (
              <DialogDescription>
                This closes the workspace and its tabs on all connected devices. Files and running
                sessions are kept.
              </DialogDescription>
            )}
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
              variant={keeps ? "default" : "destructive"}
              disabled={!canEdit || pending}
              onClick={() => {
                setPending(true);
                setError(null);
                void execute({
                  kind: keeps ? "project.close" : "project.remove",
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
