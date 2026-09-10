import { FolderOpen, GitBranch, Plus } from "lucide-react";
import { useContext, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export function NewWorkspaceMenu({
  disabled,
  onNew,
  onOpen,
}: {
  disabled: boolean;
  onNew: () => void;
  onOpen: (mode: "open" | "clone") => void;
}) {
  const compact = useContext(CompactLayoutContext);
  const [open, setOpen] = useState(false);
  if (compact)
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="mobile-icon" aria-label="Open workspace menu" disabled={disabled}>
          <Plus />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open workspace</DialogTitle>
            <DialogDescription>Work with folders on the selected machine.</DialogDescription>
          </DialogHeader>
          <div className="mobile-account-actions">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              <Plus />
              New workspace
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen("open");
              }}
            >
              <FolderOpen />
              Open folder…
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen("clone");
              }}
            >
              <GitBranch />
              Clone repository…
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open workspace menu"
          title="Open workspace menu"
          disabled={disabled}
          className="rounded p-1 text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
        >
          <Plus className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onNew}>
            <Plus />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("open")}>
            <FolderOpen />
            Open folder…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("clone")}>
            <GitBranch />
            Clone repository…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
