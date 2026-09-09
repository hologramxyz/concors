import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { visibleAgentSessions } from "./visible-sessions";
import { AgentLoadingIcon } from "./activity";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { useAgents, AGENT_STATUS } from "./context";
export function AgentSidebar({
  onSelect,
  workspace,
}: {
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
}) {
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const visible = visibleAgentSessions(workspace, chats, terminals);
  const agents = [
    ...visible.chats.map((agent) => ({
      id: agent.id,
      projectId: agent.projectId,
      name: agent.name,
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
              : "Open in terminal",
      color: session.agentActivity === "needs_input" ? "bg-amber-500" : "bg-muted-foreground/60",
      unread: false,
    })),
  ].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agents.length)
    return <p className="px-2 py-2 text-[13px] text-muted-foreground">No agents yet.</p>;
  return (
    <ul className="mt-1 space-y-0.5">
      {agents.map((agent) => {
        const { running, status, unread } = agent;
        const projectName =
          workspace?.projects.find((project) => project.id === agent.projectId)?.name ??
          "Project no longer available";
        return (
          <li key={agent.id}>
            <Tooltip delayDuration={250}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-sidebar-accent"
                  onClick={() => onSelect(agent.id)}
                >
                  <span
                    role="img"
                    aria-label={`Agent status: ${status}`}
                    className="relative flex size-4 shrink-0 items-center justify-center"
                  >
                    {unread && (
                      <span
                        aria-label="Unread agent update"
                        className="absolute inset-0 rounded-full ring-1 ring-muted-foreground/40"
                      />
                    )}
                    {running ? (
                      <AgentLoadingIcon />
                    ) : (
                      <span className="flex size-3.5 items-center justify-center rounded-full border border-current/20 text-muted-foreground">
                        <span className={`size-1.5 rounded-full ${agent.color}`} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                <div className="min-w-0">
                  <p className="font-medium break-words">{projectName}</p>
                  <p className="opacity-75">
                    {status}
                    {unread ? " · Unread update" : ""}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
