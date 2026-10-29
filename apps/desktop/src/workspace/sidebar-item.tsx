import {
  PROJECT_RENAME_CAPABILITY,
  type ProjectIcon,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspacePullRequests,
} from "@concors/protocol";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectActions } from "./project-actions";
import { ProjectImage } from "./project-image";
import { useContext, useRef, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { WorkspacePullRequestCount } from "@/pull-requests/workspace-count";
import { pullRequestsLabel } from "@/pull-requests/labels";
import { workspaceOpenCount } from "@/pull-requests/store";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import {
  workspaceAttention,
  workspaceAttentionLabel,
  type WorkspaceAttention,
} from "@/agents/agent-status";

export function WorkspaceSidebarItem({
  project,
  parent,
  compact,
  selected,
  current,
  canEdit,
  icon,
  pullRequests,
  onSelect,
  onOpenPullRequests,
  execute,
  onCommand,
}: {
  project: WorkspaceProject;
  /** Shown beside the name only when another workspace has the same name. */
  parent?: string | undefined;
  compact: boolean;
  selected: boolean;
  /**
   * Whether this is the workspace you are in, when the sidebar also lists its tabs: its name is
   * then a little stronger than the others', and the selected tab row carries the fill.
   */
  current?: boolean | undefined;
  canEdit: boolean;
  icon: ProjectIcon | undefined;
  pullRequests?: WorkspacePullRequests | undefined;
  onSelect: (id: string) => void;
  onOpenPullRequests?: (projectId: string, repository?: string) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  onCommand: (operation: WorkspaceOperation) => void;
}) {
  const mobile = useContext(CompactLayoutContext);
  const connection = useContext(TerminalConnectionContext);
  const openPullRequests = workspaceOpenCount(pullRequests);
  const attention = workspaceAttention(project, useAgents(), useTerminalSessions());
  // Older daemons reject `project.rename` outright, so the menu item stays disabled for them.
  const canRename =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PROJECT_RENAME_CAPABILITY);
  // Mirrors the agent rename: the ref stops blur after Enter/Escape from committing a second time.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameRef = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const setRename = (value: string | null) => {
    renameRef.current = value;
    setRenaming(value);
  };
  const commitRename = () => {
    const value = renameRef.current;
    if (value === null) return;
    setRename(null);
    const name = value.trim().slice(0, 120);
    // Clearing the field returns to the folder's name, which then follows the shell again.
    if (name ? name === project.name : !project.renamed) return;
    onCommand({
      kind: "project.rename",
      projectId: project.id,
      expectedVersion: project.version,
      name: name || null,
    });
  };
  const image = (
    <span className="relative flex shrink-0">
      <ProjectImage
        key={icon?.source ?? "fallback"}
        source={icon?.source ?? null}
        isGit={icon?.isGit ?? false}
        name={project.name}
      />
      <AttentionBadge attention={attention} />
    </span>
  );
  const button = (
    <button
      type="button"
      disabled={!canEdit}
      aria-label={project.name}
      data-workspace-id={project.id}
      onClick={() => onSelect(project.id)}
      // The workspace you are in, even while one of its tab rows carries the selection's fill.
      aria-current={(current ?? selected) ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center rounded-md text-ui disabled:opacity-50",
        compact ? "sidebar-rail-control font-semibold" : "h-8 gap-2 px-2",
      )}
    >
      {image}
      {!compact && (
        <span className={cn("truncate", current === false && "text-sidebar-foreground/80")}>
          {project.name}
        </span>
      )}
      {!compact && parent && (
        <span className="min-w-0 shrink-[2] truncate text-muted-foreground">{parent}</span>
      )}
    </button>
  );
  return (
    <li
      className={cn(
        // Keyboard focus shows, but a clicked row does not stay filled once selection moves on.
        "group flex items-center rounded-md hover:bg-sidebar-accent/50 has-[:focus-visible]:bg-sidebar-accent/50 has-[[data-state=open]]:bg-sidebar-accent/50",
        selected && "bg-sidebar-accent hover:bg-sidebar-accent",
        mobile && "mobile-project",
      )}
    >
      {renaming !== null ? (
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2">
          {image}
          <input
            ref={renameInput}
            aria-label="Workspace name"
            autoFocus
            value={renaming}
            maxLength={120}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRename(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              // Keep Enter, Escape and app shortcuts away from the handlers outside the sidebar.
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRename(null);
              }
            }}
            className="min-w-0 flex-1 rounded bg-background px-1.5 py-0.5 text-ui text-foreground ring-1 ring-ring outline-none"
          />
        </div>
      ) : mobile ? (
        button
      ) : (
        <Tooltip delayDuration={250}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <div className="min-w-0 break-words">
              <p className="font-medium">{project.name}</p>
              <p className="opacity-75">{project.directory}</p>
              {attention.kind && (
                <p className="opacity-75">Agents: {workspaceAttentionLabel(attention)}</p>
              )}
              {openPullRequests > 0 && (
                <p className="opacity-75">{pullRequestsLabel(openPullRequests)}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {/* Before the menu, so every row's "…" sits at the same edge. */}
      {!compact && onOpenPullRequests && (
        <WorkspacePullRequestCount
          project={project}
          listing={pullRequests}
          onOpen={onOpenPullRequests}
        />
      )}
      {!compact && (
        <ProjectActions
          project={project}
          canEdit={canEdit}
          execute={execute}
          renaming={renaming !== null}
          onRename={canRename ? () => setRename(project.name) : undefined}
          onCloseAutoFocus={(event) => {
            // The menu's focus trap outlives the input's autoFocus, so hand focus over here
            // instead of returning it to the trigger.
            if (renameRef.current === null) return;
            event.preventDefault();
            renameInput.current?.focus();
          }}
        />
      )}
    </li>
  );
}

/**
 * The corner of a workspace's icon, when something in it wants a look: a question, a failure or a
 * finished turn. Work in progress shows on its own row instead, so the icon stays still.
 */
function AttentionBadge({ attention }: { attention: WorkspaceAttention }) {
  if (!attention.kind || attention.kind === "working") return null;
  return (
    <span
      data-workspace-attention={attention.kind}
      className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-sidebar ring-1 ring-sidebar"
    >
      <span
        className={cn(
          "size-2 rounded-full",
          attention.kind === "done" ? "bg-primary" : "bg-destructive",
        )}
      />
    </span>
  );
}
