import { TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { visibleAgentSessions } from "./visible-sessions";
import { AgentLoadingIcon } from "./activity";
import { ProviderIcon } from "./provider-icon";
import { agentProviderName } from "@concors/protocol";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { useAgents, AGENT_STATUS } from "./context";
export function AgentSidebar({
  onSelect,
  workspace,
  compact = false,
}: {
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  compact?: boolean;
}) {
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const visible = visibleAgentSessions(workspace, chats, terminals);
  const agents = [
    ...visible.chats.map((agent) => ({
      id: agent.id,
      projectId: agent.projectId,
      name: agent.name,
      provider: agent.engine ?? agent.provider,
      providerName: agent.providerLabel ?? agentProviderName(agent.provider),
      updatedAt: agent.updatedAt,
      running: agent.status === "starting" || agent.status === "working",
      status: AGENT_STATUS[agent.status],
      color:
        agent.status === "done"
          ? "bg-emerald-500"
          : agent.status === "failed"
            ? "bg-red-500"
            : agent.status === "needs_input"
              ? "bg-amber-500"
              : "bg-muted-foreground/60",
      unread: !!(agent.attention && !agent.attention.seen),
    })),
    ...visible.terminals.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      provider: session.detectedAgent ?? session.profile,
      providerName: agentProviderName(session.detectedAgent ?? session.profile),
      name:
        TAB_PROFILES.find(
          (profile) => profile.profile === (session.detectedAgent ?? session.profile),
        )?.label ??
        session.detectedAgent ??
        session.profile,
      updatedAt: session.startedAt,
      running: session.status === "starting" || session.agentActivity === "working",
      status:
        session.status === "starting"
          ? "Starting"
          : session.agentActivity === "working"
            ? "Working"
            : session.agentActivity === "needs_input"
              ? "Needs input"
              : session.agentActivity === "idle" && session.agentTurnCompleted
                ? "Done"
                : "Open in terminal",
      color:
        session.agentActivity === "needs_input"
          ? "bg-amber-500"
          : session.agentActivity === "idle" && session.agentTurnCompleted
            ? "bg-emerald-500"
            : "bg-muted-foreground/60",
      unread: false,
    })),
  ].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agents.length)
    return compact ? null : (
      <p className="px-2 py-2 text-ui text-muted-foreground">No agents yet.</p>
    );
  const list = (
    <ul className="mt-1 space-y-0.5">
      {agents.map((agent) => {
        const { running, status, unread } = agent;
        const projectName =
          workspace?.projects.find((project) => project.id === agent.projectId)?.name ??
          "Project no longer available";
        return (
          <li key={agent.id}>
            <SidebarTooltip collapsed={compact} delayDuration={250}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`flex w-full items-center rounded-md text-ui hover:bg-sidebar-accent ${compact ? "sidebar-rail-control" : "h-8 gap-2 px-2 text-left"}`}
                  aria-label={
                    compact ? `Agent status: ${status} · ${agent.name} · ${projectName}` : undefined
                  }
                  data-agent-id={agent.id}
                  onClick={() => onSelect(agent.id)}
                >
                  <span
                    role="img"
                    aria-label={`Agent status: ${status}`}
                    className={`relative flex shrink-0 items-center justify-center ${compact ? "size-5" : "size-4"}`}
                  >
                    {compact && (
                      <span aria-hidden="true" data-provider={agent.provider}>
                        <ProviderIcon provider={agent.provider} />
                      </span>
                    )}
                    {unread && (
                      <span
                        aria-label="Unread agent update"
                        className={
                          compact
                            ? "absolute -top-1 -left-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
                            : "absolute inset-0 rounded-full ring-1 ring-muted-foreground/40"
                        }
                      />
                    )}
                    <span
                      className={
                        compact
                          ? "absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-sidebar ring-1 ring-sidebar"
                          : "contents"
                      }
                    >
                      {running ? (
                        <AgentLoadingIcon className={compact ? "size-3" : "size-4"} />
                      ) : compact ? (
                        <span className={`size-2 rounded-full ${agent.color}`} />
                      ) : (
                        <span className="flex size-3.5 items-center justify-center rounded-full border border-current/20 text-muted-foreground">
                          <span className={`size-1.5 rounded-full ${agent.color}`} />
                        </span>
                      )}
                    </span>
                  </span>
                  {!compact && <span className="min-w-0 flex-1 truncate">{agent.name}</span>}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                <div className="min-w-0">
                  {compact && (
                    <p className="font-medium break-words">
                      {agent.name} · {agent.providerName}
                    </p>
                  )}
                  <p className="font-medium break-words">{projectName}</p>
                  <p className="opacity-75">
                    {status}
                    {unread ? " · Unread update" : ""}
                  </p>
                </div>
              </TooltipContent>
            </SidebarTooltip>
          </li>
        );
      })}
    </ul>
  );
  return compact ? <section aria-label="Agents">{list}</section> : list;
}
