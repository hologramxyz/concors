import { ChevronDown, FolderOpen, GitBranch, Plus } from "lucide-react";
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
  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label="New workspace"
        title="New workspace"
        disabled={disabled}
        onClick={onNew}
        className="rounded p-1 text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open workspace menu"
          disabled={disabled}
          className="rounded p-1 text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
        >
          <ChevronDown className="size-3.5" />
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
