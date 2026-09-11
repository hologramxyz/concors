import { FolderOpen, GitBranch, Plus } from "lucide-react";
import { useContext, useRef, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  rail = false,
}: {
  disabled: boolean;
  onNew: () => void;
  onOpen: (mode: "open" | "clone", trigger?: HTMLElement | null) => void;
  rail?: boolean;
}) {
  const compact = useContext(CompactLayoutContext);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
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
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              ref={trigger}
              aria-label="Open workspace menu"
              disabled={disabled}
              className={`rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40 ${rail ? "sidebar-rail-control" : "p-1"}`}
            >
              <Plus className="size-4" />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={rail ? "right" : "bottom"} sideOffset={6}>
            Workspaces · New workspace or open folder
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onNew}>
            <Plus />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("open", trigger.current)}>
            <FolderOpen />
            Open folder…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("clone", trigger.current)}>
            <GitBranch />
            Clone repository…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
