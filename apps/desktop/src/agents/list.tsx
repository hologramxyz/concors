import { Clock, Ellipsis, Pencil } from "lucide-react";
import { useSchedules } from "@/schedules/use-schedules";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarEmpty } from "@/components/sidebar-section";
import { useContext, useRef, useState } from "react";
import { cn } from "cn";
import { CompactLayoutContext } from "@/components/compact-layout";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { agentPane, paneNames, visibleAgentSessions } from "./visible-sessions";
import { AgentStatusIcon } from "./activity";
import { chatAgentStatus, terminalAgentStatus, type AgentStatus } from "./agent-status";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import {
  PANE_RENAME_CAPABILITY,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { useAgents } from "./context";
export function AgentSidebar({
  onSelect,
  workspace,
  compact = false,
  canEdit = false,
  onCommand,
}: {
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  compact?: boolean;
  canEdit?: boolean;
  /** Without it the list is read-only and rows have no actions menu. */
  onCommand?: ((operation: WorkspaceOperation) => void) | undefined;
}) {
  const { schedules } = useSchedules();
  const connection = useContext(TerminalConnectionContext);
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const visible = visibleAgentSessions(workspace, chats, terminals);
  const names = paneNames(workspace);
  const canRename =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PANE_RENAME_CAPABILITY);
  const scheduled = new Set(
    schedules
      ?.filter(
        (s) =>
          s.enabled || s.runs.some((r) => r.status === "running" || r.status === "needs_input"),
      )
      .map((s) => s.sessionId),
  );
  const activeChats = chats.filter(
    (agent) => visible.chats.some((a) => a.id === agent.id) || scheduled.has(agent.id),
  );
  const agents = [
    ...activeChats.map((agent) => ({
      ...chatAgentStatus(agent),
      projectId: agent.projectId,
      defaultName: agent.name,
      updatedAt: agent.updatedAt,
    })),
    ...visible.terminals.map((session) => ({
      ...terminalAgentStatus(session),
      projectId: session.projectId,
      defaultName:
        TAB_PROFILES.find(
          (profile) => profile.profile === (session.detectedAgent ?? session.profile),
        )?.label ??
        session.detectedAgent ??
        session.profile,
      updatedAt: session.startedAt,
    })),
  ]
    .map((agent) => ({ ...agent, name: names.get(agent.id) ?? agent.defaultName }))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agents.length) return compact ? null : <SidebarEmpty>No agents yet.</SidebarEmpty>;
  const list = (
    <ul className="mt-1 space-y-0.5">
      {agents.map((agent) => {
        // Agents cannot be renamed themselves; the sidebar names the pane showing the agent, so the
        // pane title and every other list follow (see `paneNames`).
        const target = canRename && onCommand ? agentPane(workspace, agent.id) : null;
        return (
          <AgentRow
            key={agent.id}
            agent={agent}
            compact={compact}
            projectName={
              workspace?.projects.find((project) => project.id === agent.projectId)?.name ??
              "Project no longer available"
            }
            scheduled={!!schedules?.some((s) => s.enabled && s.sessionId === agent.id)}
            onSelect={onSelect}
            actions={!!onCommand}
            onRename={
              target && onCommand
                ? (value) => {
                    // Clearing the field, or typing the default back, returns to the automatic name.
                    const name = value.trim().slice(0, 120);
                    const next = name && name !== agent.defaultName ? name : null;
                    if (next === (target.pane.name ?? null)) return;
                    onCommand({
                      kind: "pane.rename",
                      projectId: target.project.id,
                      expectedVersion: target.project.version,
                      tabId: target.tab.id,
                      paneId: target.pane.id,
                      name: next,
                    });
                  }
                : undefined
            }
          />
        );
      })}
    </ul>
  );
  return compact ? <section aria-label="Agents">{list}</section> : list;
}

function AgentRow({
  agent,
  compact,
  projectName,
  scheduled,
  onSelect,
  actions,
  onRename,
}: {
  agent: AgentStatus & { name: string };
  compact: boolean;
  projectName: string;
  scheduled: boolean;
  onSelect: (id: string) => void;
  actions: boolean;
  /** Absent when this agent cannot be renamed right now; the menu item is then disabled. */
  onRename: ((name: string) => void) | undefined;
}) {
  const mobile = useContext(CompactLayoutContext);
  const { status, unread } = agent;
  // Mirrors the pane rename: the ref stops blur after Enter/Escape from committing a second time.
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
    onRename?.(value);
  };
  return (
    <li
      className={cn(
        !compact &&
          "group flex items-center rounded-md hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
      )}
    >
      {renaming !== null ? (
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2">
          <AgentStatusIcon agent={agent} />
          <input
            ref={renameInput}
            aria-label="Agent name"
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
      ) : (
        <Tooltip delayDuration={250} {...(mobile ? { open: false } : {})}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`flex items-center rounded-md text-ui ${compact ? "sidebar-rail-control w-full hover:bg-sidebar-accent" : "h-8 min-w-0 flex-1 gap-2 px-2 text-left"}`}
              aria-label={
                compact ? `Agent status: ${status} · ${agent.name} · ${projectName}` : undefined
              }
              data-agent-id={agent.id}
              onClick={() => onSelect(agent.id)}
            >
              <AgentStatusIcon agent={agent} />
              {!compact && <span className="min-w-0 flex-1 truncate">{agent.name}</span>}
              {!compact && scheduled && (
                <Clock
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Scheduled agent"
                />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            <div className="min-w-0">
              <p className="font-medium break-words">
                {agent.name} · {agent.providerName}
              </p>
              <p className="font-medium break-words">{projectName}</p>
              <p className="opacity-75">
                {status}
                {scheduled ? " · Scheduled" : ""}
                {unread ? " · Unread update" : ""}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {!compact && actions && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${agent.name}`}
            className={cn(
              "mr-1 rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-sidebar-foreground data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
              // Kept mounted while renaming so closing the menu can hand focus to the input.
              renaming !== null && "invisible",
            )}
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-56"
            onCloseAutoFocus={(event) => {
              // The menu's focus trap outlives the input's autoFocus, so hand focus over here
              // instead of returning it to the trigger.
              if (renameRef.current === null) return;
              event.preventDefault();
              renameInput.current?.focus();
            }}
          >
            <DropdownMenuItem disabled={!onRename} onSelect={() => setRename(agent.name)}>
              <Pencil /> Rename agent
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
