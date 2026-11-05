import { Bot, Clock } from "lucide-react";
import { useSchedules } from "@/schedules/use-schedules";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { SidebarEmpty } from "@/components/sidebar-section";
import type { ReactNode } from "react";
import { cn } from "cn";
import { paneNames, visibleAgentSessions } from "./visible-sessions";
import { AgentStatusIcon } from "./activity";
import { closedChats } from "./closed-chats";
import { chatAgentStatus, terminalAgentStatus, type AgentStatus } from "./agent-status";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { useAgents } from "./context";

/**
 * Closing a pane keeps its chat, so the newest few stay in reach below the open agents. The rest
 * are in Search and "Resume a chat"; the sidebar is for what someone is working on now.
 */
const RECENTLY_CLOSED = 10;

export function AgentSidebar({
  onSelect,
  workspace,
  compact = false,
  hidden,
  actions,
}: {
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  compact?: boolean;
  /** Chats waiting out an undo of their deletion, which are gone from the list already. */
  hidden?: ReadonlySet<string> | undefined;
  /** The open agent's "…" menu; without it the list is read-only. */
  actions?: ((id: string, name: string) => ReactNode) | undefined;
}) {
  const { schedules } = useSchedules();
  const chats = useAgents().filter((agent) => !hidden?.has(agent.id));
  const terminals = useTerminalSessions();
  const visible = visibleAgentSessions(workspace, chats, terminals);
  const names = paneNames(workspace);
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
  const closed = compact
    ? []
    : closedChats(workspace, chats)
        .filter((chat) => !scheduled.has(chat.agent.id))
        .slice(0, RECENTLY_CLOSED);
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
  if (!agents.length && !closed.length)
    return compact ? null : <SidebarEmpty>No agents yet.</SidebarEmpty>;
  const list = (
    <ul className="mt-1 space-y-0.5 empty:hidden">
      {agents.map((agent) => (
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
          actions={compact ? null : actions?.(agent.id, agent.name)}
        />
      ))}
    </ul>
  );
  if (compact) return <section aria-label="Agents">{list}</section>;
  if (!closed.length) return list;
  return (
    <>
      {list}
      <p className="mt-3 px-2 text-xs text-muted-foreground">Recently closed</p>
      <ul aria-label="Recently closed agents" className="mt-1 space-y-0.5">
        {closed.map((chat) => (
          <AgentRow
            key={chat.agent.id}
            agent={{
              ...chatAgentStatus(chat.agent),
              status: "Closed",
              running: false,
              name: chat.title,
            }}
            compact={false}
            closed
            projectName={chat.projectName}
            scheduled={false}
            onSelect={onSelect}
            actions={null}
          />
        ))}
      </ul>
    </>
  );
}

function AgentRow({
  agent,
  compact,
  closed = false,
  projectName,
  scheduled,
  onSelect,
  actions,
}: {
  agent: AgentStatus & { name: string };
  compact: boolean;
  /** No pane shows it; selecting it opens it again in a tab of its workspace. */
  closed?: boolean;
  projectName: string;
  scheduled: boolean;
  onSelect: (id: string) => void;
  /** Its "…" menu, if it has one. */
  actions: ReactNode;
}) {
  const { status, dot, background } = agent;
  const backgroundLabel = background
    ? `${background} sub-agent${background === 1 ? "" : "s"} running`
    : "";
  return (
    <li
      className={cn(
        !compact &&
          "group flex items-center rounded-md hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
      )}
    >
      <SidebarTooltip
        content={
          <div className="min-w-0">
            <p className="font-medium break-words">
              {agent.name}, {agent.providerName}
            </p>
            <p className="font-medium break-words">{projectName}</p>
            <p className="opacity-75">
              {status}
              {backgroundLabel ? `, ${backgroundLabel}` : ""}
              {scheduled ? ", Scheduled" : ""}
              {dot === "done" ? ", Unread update" : ""}
            </p>
          </div>
        }
      >
        <button
          type="button"
          className={`flex items-center rounded-md text-ui ${compact ? "sidebar-rail-control w-full hover:bg-sidebar-accent" : "h-8 min-w-0 flex-1 gap-2 px-2 text-left"}`}
          aria-label={
            compact
              ? `Agent status: ${status}${backgroundLabel ? `, ${backgroundLabel}` : ""}, ${agent.name}, ${projectName}`
              : undefined
          }
          data-agent-id={agent.id}
          data-agent-closed={closed || undefined}
          onClick={() => onSelect(agent.id)}
        >
          <AgentStatusIcon agent={agent} />
          {!compact && (
            <span className={cn("min-w-0 flex-1 truncate", closed && "text-muted-foreground")}>
              {agent.name}
            </span>
          )}
          {!compact && background > 0 && (
            <span
              data-background-agents={background}
              aria-label={backgroundLabel}
              className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
            >
              <Bot aria-hidden="true" className="size-3.5 motion-safe:animate-pulse" />
              {background > 1 && background}
            </span>
          )}
          {!compact && scheduled && (
            <Clock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Scheduled agent"
            />
          )}
        </button>
      </SidebarTooltip>
      {!compact && actions}
    </li>
  );
}
