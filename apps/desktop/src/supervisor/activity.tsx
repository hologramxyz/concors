import { useState } from "react";
import { supervisorAgentName } from "./reference-context";
import { ArrowUpRight, Check, ListChecks, ShieldAlert, X } from "lucide-react";
import type { AgentInfo, WorkspaceSnapshot } from "@concors/protocol";
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

const groups = [
  {
    title: "Needs you",
    matches: (a: AgentInfo) => a.pending.length > 0 || a.status === "needs_input",
  },
  {
    title: "Working",
    matches: (a: AgentInfo) => a.status === "working" || a.status === "starting",
  },
  { title: "Queued", matches: (a: AgentInfo) => !!a.queue?.length },
  {
    title: "Stopped",
    matches: (a: AgentInfo) => a.status === "failed" || a.status === "interrupted",
  },
  { title: "Finished", matches: (a: AgentInfo) => a.status === "done" },
] as const;

export function SupervisorActivityButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const agents = useAgents();
  const blockers = agents.filter((a) => !a.supervisor && groups[0].matches(a)).length;
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "ghost"}
      aria-expanded={open}
      aria-label={blockers ? `Activity, ${blockers} need you` : "Activity"}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground"
    >
      <ListChecks className="size-4" />
      Activity
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
}: {
  workspace: WorkspaceSnapshot | null;
  compact: boolean;
  onClose: () => void;
  onOpenAgent: (sessionId: string) => void;
}) {
  const agents = useAgents();
  const [projectId, selectProject] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
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
  const byStatus = groups.map((group, index) => ({
    title: group.title,
    agents: scoped.filter(
      (agent) =>
        group.matches(agent) && !groups.slice(0, index).some((group) => group.matches(agent)),
    ),
  }));
  const reviewing = scoped.find((agent) => agent.id === selected);
  const request = reviewing?.pending[0];
  const openChat = (agent: AgentInfo) => {
    onClose();
    onOpenAgent(agent.id);
  };
  const contents =
    reviewing && request ? (
      <div className="space-y-3">
        <Button variant="ghost" onClick={() => setSelected(null)}>
          ← All activity
        </Button>
        <section className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-3.5 text-destructive" />
            {projectNames.get(reviewing.projectId)} / {supervisorAgentName(reviewing)}
          </div>
          <h3 className="text-ui font-medium">{request.title}</h3>
          {request.summary && (
            <p className="text-ui break-words text-muted-foreground">{request.summary}</p>
          )}
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Request details
            </summary>
            <pre className="chat-scroll mt-2 max-h-40 overflow-auto rounded-md border bg-background p-2 text-xs break-words whitespace-pre-wrap">
              {request.detail}
            </pre>
          </details>
          <Button onClick={() => openChat(reviewing)}>
            <ArrowUpRight /> Open agent chat
          </Button>
        </section>
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
        {!byStatus.some((group) => group.agents.length > 0) && (
          <p className="py-4 text-ui text-muted-foreground">No recent agent activity.</p>
        )}
        {byStatus.map(
          ({ title, agents: rows }) =>
            rows.length > 0 && (
              <section key={title} aria-label={title}>
                <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                  {title}
                  <span className="tabular-nums">{rows.length}</span>
                </h3>
                <ul className="divide-y overflow-hidden rounded-md border">
                  {rows.map((agent) => (
                    <li key={agent.id}>
                      <button
                        type="button"
                        onClick={() =>
                          agent.pending.length > 0 ? setSelected(agent.id) : openChat(agent)
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
                          <span className="block truncate text-ui font-medium">
                            {supervisorAgentName(agent)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {projectNames.get(agent.projectId)}
                            {agent.pending[0]
                              ? ` · ${agent.pending[0].summary || agent.pending[0].title}`
                              : agent.queue?.length
                                ? ` · ${agent.queue.length} queued`
                                : ""}
                          </span>
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
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-3">{contents}</div>
    </aside>
  );
}
