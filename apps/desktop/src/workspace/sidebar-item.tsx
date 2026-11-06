import {
  PROJECT_RENAME_CAPABILITY,
  type ProjectIcon,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspacePullRequests,
} from "@concors/protocol";
import { cn } from "cn";
import { AgentLoadingIcon } from "@/agents/activity";
import { ChevronRight } from "lucide-react";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { ProjectActions } from "./project-actions";
import { ProjectImage } from "./project-image";
import { useContext, useRef, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { WorkspacePullRequestCount } from "@/pull-requests/workspace-count";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { useHomePath } from "./home-path";
import {
  AGENT_DOT_COLOR,
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
  expanded,
  canEdit,
  dropTarget = false,
  icon,
  pullRequests,
  onSelect,
  toggles = false,
  onNewTab,
  onToggleExpanded,
  onOpenPullRequests,
  execute,
  onCommand,
}: {
  project: WorkspaceProject;
  /** A chat being dragged would move here if dropped now. */
  dropTarget?: boolean;
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
  /** Its open list shows each dot on its own row, so the folder has no dot of its own. */
  expanded?: boolean;
  onSelect: (id: string) => void;
  /**
   * Choosing the row only expands or collapses it, so it says so to a screen reader and shows
   * desktop's fold chevron in place of its icon.
   */
  toggles?: boolean;
  /** Offers New tab in the workspace's phone menu. */
  onNewTab?: ((projectId: string) => void) | undefined;
  /** Offers a chevron over the icon on hover and keyboard focus, which only folds the workspace. */
  onToggleExpanded?: () => void;
  onOpenPullRequests?: (projectId: string, repository?: string) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  onCommand: (operation: WorkspaceOperation) => void;
}) {
  const mobile = useContext(CompactLayoutContext);
  const connection = useContext(TerminalConnectionContext);
  const summed = workspaceAttention(project, useAgents(), useTerminalSessions());
  const attention = expanded
    ? { ...summed, kind: null, needsInput: 0, failed: 0, done: 0, working: 0 }
    : summed;
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
  const folder = useHomePath()(project.directory);
  const attentionLabel = workspaceAttentionLabel(attention);
  const details = (folder || attentionLabel) && (
    <>
      {folder && <p>{folder}</p>}
      {attentionLabel && <p className="opacity-75">{attentionLabel}</p>}
    </>
  );
  // Touch has no hover to reveal it, and the rail's icon is the whole control.
  const foldable = onToggleExpanded && !mobile && !compact && renaming === null;
  const image = (
    <span className="relative flex shrink-0">
      <span
        className={cn(
          "flex",
          foldable &&
            "group-hover:opacity-0 group-has-[:focus-visible:not([data-pointer-focus])]:opacity-0",
        )}
      >
        {toggles && !compact ? (
          // Desktop's fold chevron, shown for good where touch has no hover to reveal it. The row
          // itself is the toggle, so this only shows which way it is folded.
          <span
            aria-hidden="true"
            data-workspace-chevron={expanded ? "expanded" : "collapsed"}
            className="flex size-[20px] items-center justify-center text-muted-foreground"
          >
            <ChevronRight
              className={cn(
                "size-[16px] transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
          </span>
        ) : (
          <ProjectImage
            key={icon?.source ?? "fallback"}
            source={icon?.source ?? null}
            isGit={icon?.isGit ?? false}
            name={project.name}
          />
        )}
      </span>
      <AttentionBadge attention={attention} label={attentionLabel} />
    </span>
  );
  const button = (
    <button
      type="button"
      data-steady-while-creating
      disabled={!canEdit}
      // A button's name replaces its contents for a screen reader, so the dot's text goes here too.
      aria-label={attentionLabel ? `${project.name}, ${attentionLabel}` : project.name}
      data-workspace-id={project.id}
      onClick={() => onSelect(project.id)}
      // The workspace you are in, even while one of its tab rows carries the selection's fill.
      aria-current={(current ?? selected) ? "page" : undefined}
      aria-expanded={toggles ? !!expanded : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center rounded-md text-ui disabled:opacity-50",
        compact ? "sidebar-rail-control font-semibold" : "h-8 gap-2 px-2",
      )}
    >
      {image}
      {!compact && (
        <span className={cn("truncate", current === false && "text-sidebar-foreground/80")}>
          {mobile ? (
            project.name
          ) : (
            // Only the name opens the tooltip, so the rest of the row stays free for its controls.
            <SidebarTooltip content={details}>
              <span>{project.name}</span>
            </SidebarTooltip>
          )}
        </span>
      )}
      {!compact && parent && (
        <span className="min-w-0 shrink-[2] truncate text-muted-foreground">{parent}</span>
      )}
    </button>
  );
  return (
    <li
      data-drop-workspace={project.id}
      data-drop-target={dropTarget || undefined}
      className={cn(
        // Keyboard focus shows, but a clicked row does not stay filled once selection moves on.
        // An open menu is matched by `aria-expanded`, as the tooltip around its trigger keeps
        // `data-state` closed, and by its popup, as the fold chevron is `aria-expanded` too.
        // `data-state` still marks the pull request count's open hover card.
        "group relative flex items-center rounded-md hover:bg-sidebar-accent/70 has-[:focus-visible:not([data-pointer-focus])]:bg-sidebar-accent/70 has-[[aria-haspopup=menu][aria-expanded=true]]:bg-sidebar-accent/70 has-[[data-state=open]]:bg-sidebar-accent/70",
        selected &&
          "bg-sidebar-accent hover:bg-sidebar-accent has-[[aria-haspopup=menu][aria-expanded=true]]:bg-sidebar-accent",
        mobile && "mobile-project",
      )}
    >
      {foldable && (
        // Laid over the icon rather than beside it, so the row's layout is the same either way.
        <SidebarTooltip content={expanded ? "Collapse" : "Expand"}>
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
            aria-expanded={!!expanded}
            data-workspace-toggle={project.id}
            onClick={onToggleExpanded}
            className="absolute inset-y-0 left-0 z-10 flex w-[calc(0.5rem+22px)] items-center rounded-md pl-2 text-muted-foreground opacity-0 group-hover:opacity-100 group-has-[:focus-visible:not([data-pointer-focus])]:opacity-100 hover:text-sidebar-foreground"
          >
            {/* In pixels, as `ProjectImage` is: the folder glyph it replaces is 16 of its 20. */}
            <span className="flex size-[20px] items-center justify-center">
              <ChevronRight
                className={cn(
                  "size-[16px] transition-transform duration-200 motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
              />
            </span>
          </button>
        </SidebarTooltip>
      )}
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
      ) : mobile || !compact ? (
        button
      ) : (
        <SidebarTooltip content={details}>{button}</SidebarTooltip>
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
          onNewTab={onNewTab && (() => onNewTab(project.id))}
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
 * finished turn, or, folded, an agent still at work, with the spinner a tab's badge has. Unfolded,
 * work in progress shows on its own row instead.
 */
function AttentionBadge({ attention, label }: { attention: WorkspaceAttention; label: string }) {
  if (!attention.kind) return null;
  return (
    <span
      role="img"
      aria-label={label}
      data-workspace-attention={attention.kind}
      // Above the chevron that replaces the icon on hover, which still takes the click.
      className="pointer-events-none absolute -right-1 -bottom-1 z-20 flex size-3 items-center justify-center rounded-full bg-sidebar ring-1 ring-sidebar"
    >
      {attention.kind === "working" ? (
        <AgentLoadingIcon className="size-3" />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            AGENT_DOT_COLOR[attention.kind === "done" ? "done" : "attention"],
          )}
        />
      )}
    </span>
  );
}
