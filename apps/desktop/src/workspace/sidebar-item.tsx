import type { ProjectIcon, WorkspaceOperation, WorkspaceProject } from "@concors/protocol";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectActions } from "./project-actions";
import { ProjectImage } from "./project-image";

export function WorkspaceSidebarItem({
  project,
  compact,
  selected,
  canEdit,
  icon,
  onSelect,
  execute,
}: {
  project: WorkspaceProject;
  compact: boolean;
  selected: boolean;
  canEdit: boolean;
  icon: ProjectIcon | undefined;
  onSelect: (id: string) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
}) {
  const button = (
    <button
      type="button"
      disabled={!canEdit}
      aria-label={project.name}
      data-workspace-id={project.id}
      onClick={() => onSelect(project.id)}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center rounded-md text-ui disabled:opacity-50",
        compact ? "sidebar-rail-control font-semibold" : "h-8 gap-2 px-2",
      )}
    >
      <ProjectImage
        key={icon?.source ?? "fallback"}
        source={icon?.source ?? null}
        isGit={icon?.isGit ?? false}
        name={project.name}
      />
      {!compact && <span className="truncate">{project.name}</span>}
    </button>
  );
  return (
    <li
      className={cn(
        "group flex items-center rounded-md focus-within:bg-sidebar-accent hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
        selected && "bg-sidebar-accent",
      )}
    >
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <div className="min-w-0 break-words">
            <p className="font-medium">{project.name}</p>
            <p className="opacity-75">{project.directory}</p>
          </div>
        </TooltipContent>
      </Tooltip>
      {!compact && <ProjectActions project={project} canEdit={canEdit} execute={execute} />}
    </li>
  );
}
