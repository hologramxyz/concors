import { Folder, FolderOpen, GitBranch, Plus } from "lucide-react";
import { useContext, useRef, useState } from "react";
import type { RecentlyClosed } from "./closed-workspaces";
import { CompactLayoutContext } from "@/components/compact-layout";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NewWorkspaceMenu({
  disabled,
  onNew,
  onOpen,
  closed = [],
  onReopen,
  rail = false,
}: {
  disabled: boolean;
  onNew: () => void;
  onOpen: (mode: "open" | "clone", trigger?: HTMLElement | null) => void;
  /** Recently closed workspaces, listed below the rest for one-click reopening. */
  closed?: readonly RecentlyClosed[];
  onReopen?: (projectId: string) => void;
  rail?: boolean;
}) {
  const recent = onReopen ? closed : [];
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
            {recent.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onReopen?.(project.id);
                }}
              >
                <Folder />
                {project.name}
                {project.clashes && (
                  <span className="truncate text-muted-foreground">{project.directory}</span>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <SidebarTooltip collapsed={rail}>
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
            New workspace or open folder
          </TooltipContent>
        </SidebarTooltip>
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
          {recent.length > 0 && <DropdownMenuSeparator />}
          {recent.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => onReopen?.(project.id)}>
              <Folder />
              <span className="truncate">{project.name}</span>
              {project.clashes && (
                <span className="min-w-0 shrink-[2] truncate text-muted-foreground">
                  {project.directory}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
