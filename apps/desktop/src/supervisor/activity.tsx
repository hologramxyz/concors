import { approvalSummary } from "@/agents/approval-summary";
import { useState } from "react";
import { supervisorAgentName } from "./reference-context";
import {
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  ListChecks,
  MessageCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import type { AgentInfo, AgentPending, WorkspaceSnapshot } from "@concors/protocol";
import { useAgents } from "@/agents/context";
import { AgentLoadingIcon } from "@/agents/activity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { activityGroups, activityRows } from "./activity-model";
import { useSupervisorActivity } from "./use-activity";

const blocked = (agent: AgentInfo) => agent.pending.length > 0 || agent.status === "needs_input";

export function SupervisorActivityButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const agents = useAgents();
  const blockers = agents.filter((a) => !a.supervisor && blocked(a)).length;
  const finished = agents.filter(
    (a) => !a.supervisor && a.attention?.kind === "done" && !a.attention.seen,
  ).length;
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "ghost"}
      aria-expanded={open}
      aria-label={
        blockers
          ? `Activity, ${blockers} need you`
          : finished
            ? `Activity, ${finished} finished`
            : "Activity"
      }
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground"
    >
      <ListChecks className="size-4" />
      Activity
      {!blockers && finished > 0 && (
        <span className="rounded-full bg-muted px-1.5 text-xs text-foreground">{finished}</span>
      )}
      {blockers > 0 && (
        <span className="rounded-full bg-destructive/10 px-1.5 text-xs text-destructive">
          {blockers}
        </span>
      )}
    </Button>
  );
}

export function SupervisorActivity({
  workspace,
  compact,
  onClose,
  onOpenAgent,
  supervisorId,
  canAsk,
  onAsk,
}: {
  workspace: WorkspaceSnapshot | null;
  compact: boolean;
  onClose: () => void;
  onOpenAgent: (sessionId: string) => void;
  supervisorId: string | null;
  canAsk: boolean;
  onAsk: (agent: AgentInfo, request: AgentPending, workspace: string) => void;
}) {
  const agents = useAgents();
  const [projectId, selectProject] = useState("");
  const [selected, setSelected] = useState<{ sessionId: string; task?: string } | null>(null);
  const [changingWatch, setChangingWatch] = useState(false);
  const { deliveries, watching, warning, watch } = useSupervisorActivity(supervisorId);
  const projects = [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])];
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const scoped = agents
    .filter(
      (agent) =>
        !agent.supervisor &&
        projectNames.has(agent.projectId) &&
        (!projectId || agent.projectId === projectId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = activityRows(scoped, deliveries);
  const byStatus = activityGroups.map((title) => ({
    title,
    rows: rows.filter((row) => row.group === title),
  }));
  const reviewing = scoped.find((agent) => agent.id === selected?.sessionId);
  const isWatching = !!reviewing && watching.includes(reviewing.id);
  const openChat = (agent: AgentInfo) => {
    onClose();
    onOpenAgent(agent.id);
  };
  const contents = reviewing ? (
    <div className="space-y-3">
      <Button variant="ghost" onClick={() => setSelected(null)}>
        ← All activity
      </Button>
      <section className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {projectNames.get(reviewing.projectId)}
        </div>
        <h3 className="text-ui font-medium">{supervisorAgentName(reviewing)}</h3>
        {selected?.task && (
          <p className="text-ui break-words text-muted-foreground">{selected.task}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => openChat(reviewing)}>
            <ArrowUpRight /> Open agent chat
          </Button>
          {watch && (
            <Button
              variant="outline"
              title="Bring this chat’s updates into Supervisor"
              aria-pressed={isWatching}
              disabled={changingWatch}
              onClick={() => {
                setChangingWatch(true);
                void watch(reviewing.id, !isWatching).finally(() => setChangingWatch(false));
              }}
            >
              {isWatching ? <BellOff /> : <Bell />}
              {isWatching ? "Stop watching" : "Watch chat"}
            </Button>
          )}
        </div>
      </section>
      {reviewing.pending.map((request) => (
        <section key={request.id} className="space-y-2 rounded-lg border bg-card p-3">
          <h3 className="flex items-center gap-2 text-ui font-medium">
            <ShieldAlert className="size-3.5 shrink-0 text-destructive" />
            {request.title}
          </h3>
          {approvalSummary(request) && (
            <p className="line-clamp-3 text-ui break-words text-muted-foreground">
              {approvalSummary(request)}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Request details
            </summary>
            <pre className="chat-scroll mt-2 max-h-40 overflow-auto rounded-md border bg-background p-2 text-xs break-words whitespace-pre-wrap">
              {request.plan || request.detail}
            </pre>
          </details>
          {request.kind === "approval" && (
            <Button
              variant="outline"
              disabled={!canAsk}
              onClick={() => onAsk(reviewing, request, projectNames.get(reviewing.projectId) ?? "")}
            >
              <MessageCircle /> Ask Supervisor
            </Button>
          )}
        </section>
      ))}
    </div>
  ) : (
    <div className="space-y-4">
      <select
        aria-label="Filter by workspace"
        value={projectId}
        onChange={(e) => selectProject(e.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
      >
        <option value="">All workspaces</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {!byStatus.some((group) => group.rows.length > 0) && (
        <p className="py-4 text-ui text-muted-foreground">No recent agent activity.</p>
      )}
      {byStatus.map(
        ({ title, rows }) =>
          rows.length > 0 && (
            <section key={title} aria-label={title}>
              <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                {title}
                <span className="tabular-nums">{rows.length}</span>
              </h3>
              <ul className="divide-y overflow-hidden rounded-md border">
                {rows.map(({ id, agent, task }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected({ sessionId: agent.id, ...(task ? { task } : {}) })
                      }
                      className="flex w-full items-start gap-2.5 px-2.5 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted"
                    >
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                        {title === "Needs you" ? (
                          <ShieldAlert className="size-3.5 text-destructive" />
                        ) : title === "Working" ? (
                          <AgentLoadingIcon className="size-3.5" />
                        ) : title === "Finished" ? (
                          <Check className="size-3.5" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-ui font-medium">
                          <span className="truncate">{supervisorAgentName(agent)}</span>
                          {watching.includes(agent.id) && (
                            <Bell
                              className="size-3 shrink-0 text-muted-foreground"
                              aria-label="Watching"
                            />
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {projectNames.get(agent.projectId)}
                          {agent.pending[0]
                            ? ` · ${approvalSummary(agent.pending[0]) || agent.pending[0].title}`
                            : agent.queue?.length
                              ? ` · ${agent.queue.length} queued`
                              : ""}
                        </span>
                        {task && (
                          <span
                            className="mt-1 block truncate text-xs text-foreground"
                            title={task}
                          >
                            {task}
                          </span>
                        )}
                      </span>
                      <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );

  if (compact)
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="gap-4">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription>Agent work on this machine</DialogDescription>
          </DialogHeader>
          {warning && (
            <p role="status" className="text-xs text-destructive">
              {warning}
            </p>
          )}
          {contents}
        </DialogContent>
      </Dialog>
    );

  return (
    <aside aria-label="Activity" className="flex w-[286px] shrink-0 flex-col border-l bg-muted/20">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-ui font-medium">Activity</h2>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close activity"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {warning && (
          <p role="status" className="mb-2 text-xs text-destructive">
            {warning}
          </p>
        )}
        {contents}
      </div>
    </aside>
  );
}
