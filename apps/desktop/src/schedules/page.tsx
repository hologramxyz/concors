import {
  ArrowUpRight,
  ChevronDown,
  Clock,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  SCHEDULES_CAPABILITY,
  agentProviderName,
  type AgentSchedule,
  type ScheduleOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAgents } from "@/agents/context";
import { useSchedules } from "./use-schedules";
import { ScheduleForm } from "./schedule-form";
import { cadenceLabel, dateLabel, runLabel } from "./schedule-labels";

const runStatusColor = {
  running: "bg-foreground",
  needs_input: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/60",
  interrupted: "bg-muted-foreground/60",
} as const;

export function SchedulesPage({
  workspace,
  connected,
  connectionFailed,
  onOpenAgent,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  connectionFailed: boolean;
  onOpenAgent: (id: string) => void;
}) {
  const { connection, schedules } = useSchedules(),
    agents = useAgents();
  const [editing, setEditing] = useState<AgentSchedule | "new" | null>(null);
  const [deleting, setDeleting] = useState<AgentSchedule | null>(null);
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes(SCHEDULES_CAPABILITY);
  // A schedule that has not run has no agent to name its provider, and an added subscription's id
  // is not a name. Until this answers, or if it fails, the built-in names stand in.
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!connection || !supported) return;
    let current = true;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((result) => {
        if (!current || result.outcome.status === "error") return;
        setProviderLabels(Object.fromEntries(result.outcome.providers.map((p) => [p.id, p.label])));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [connection, supported]);
  const available = !!(connected && supported && workspace && schedules);
  const canCreate = available && workspace.projects.some((p) => p.directory);
  const act = async (op: ScheduleOperation, id: string) => {
    if (!connection || pending) return;
    setPending(id);
    setError(null);
    try {
      const result = await connection.requestSchedule(op, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setDeleting(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update schedule");
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 data-page-title className="text-xl font-semibold">
            Schedules
          </h2>
          <p className="mt-1 text-ui text-muted-foreground">Run your agents on a cadence.</p>
        </div>
        {!!schedules?.length && (
          <Button disabled={!canCreate} onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            New schedule
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-ui text-destructive">
          {error}
        </p>
      )}
      {!available ? (
        // Still connecting says nothing: the machine is usually here a moment later.
        (connected || connectionFailed) && (
          <p role="status" className="my-16 text-center text-ui text-muted-foreground">
            {!connected
              ? "Connect to a machine to manage its schedules."
              : !supported
                ? "Update the daemon on this machine to use schedules."
                : "Loading schedules…"}
          </p>
        )
      ) : !schedules.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="flex size-14 items-center justify-center rounded-xl border bg-muted/40">
            <Clock className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">No schedules yet</h3>
          <Button disabled={!canCreate} onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            New schedule
          </Button>
          {!canCreate && (
            <p className="text-ui text-muted-foreground">
              Open a workspace folder to create your first schedule.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {schedules.map((schedule) => {
            const project = workspace?.projects.find((p) => p.id === schedule.projectId);
            const last =
              schedule.runs.find((r) => r.status === "running" || r.status === "needs_input") ??
              schedule.runs[0];
            const active = schedule.runs.some(
              (r) => r.status === "running" || r.status === "needs_input",
            );
            const agent = agents.find((a) => a.id === schedule.sessionId);
            return (
              <article
                key={schedule.id}
                className="overflow-hidden rounded-lg border bg-background text-ui shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium break-words">{schedule.name}</h3>
                      <Badge variant="secondary">
                        <span
                          className={`size-1.5 rounded-full ${schedule.enabled ? "bg-foreground" : "bg-muted-foreground/50"}`}
                          aria-hidden="true"
                        />
                        {schedule.enabled ? "Active" : "Paused"}
                      </Badge>
                      {last && (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                          role="status"
                        >
                          <span
                            className={`size-1.5 rounded-full ${runStatusColor[last.status]}`}
                            aria-hidden="true"
                          />
                          {runLabel[last.status]}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 break-words text-muted-foreground">
                      <span className="min-w-0">{project?.name ?? "Workspace unavailable"}</span>
                      <span>
                        {agent?.providerLabel ??
                          (schedule.target.kind === "agent"
                            ? (providerLabels[schedule.target.provider] ??
                              agentProviderName(schedule.target.provider))
                            : "Existing agent")}
                      </span>
                      {schedule.source === "agent" && <span>Created by agent</span>}
                    </p>
                  </div>
                  <div className="flex w-full items-center justify-end gap-0.5 sm:w-auto">
                    <SidebarTooltip place="title-bar" content="Run now">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Run ${schedule.name} now`}
                        disabled={!available || !!pending || active}
                        onClick={() => void act({ kind: "run", id: schedule.id }, schedule.id)}
                      >
                        <Zap className="size-4" />
                      </Button>
                    </SidebarTooltip>
                    <SidebarTooltip
                      place="title-bar"
                      content={schedule.enabled ? "Pause" : "Resume"}
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${schedule.enabled ? "Pause" : "Resume"} ${schedule.name}`}
                        disabled={!available || !!pending}
                        onClick={() =>
                          void act(
                            {
                              kind: "update",
                              id: schedule.id,
                              expectedRevision: schedule.revision,
                              schedule: { ...schedule, enabled: !schedule.enabled },
                            },
                            schedule.id,
                          )
                        }
                      >
                        {schedule.enabled ? (
                          <Pause className="size-4" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </Button>
                    </SidebarTooltip>
                    <SidebarTooltip place="title-bar" content="Edit">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${schedule.name}`}
                        disabled={!available || !!pending}
                        onClick={() => setEditing(schedule)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </SidebarTooltip>
                    <SidebarTooltip place="title-bar" content="Delete">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${schedule.name}`}
                        disabled={!available || !!pending || active}
                        onClick={() => setDeleting(schedule)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </SidebarTooltip>
                  </div>
                  <p className="line-clamp-2 w-full break-words whitespace-pre-wrap text-foreground/80">
                    {schedule.prompt}
                  </p>
                  <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2.5 text-muted-foreground">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-2">
                        <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                        {cadenceLabel(schedule.cadence)}
                      </span>
                      {schedule.cadence.kind !== "interval" && (
                        <span>{schedule.cadence.timezone}</span>
                      )}
                    </span>
                    {schedule.enabled && (
                      <span>
                        {schedule.nextRunAt
                          ? `Next ${dateLabel(schedule.nextRunAt)}`
                          : "No upcoming runs"}
                      </span>
                    )}
                  </div>
                </div>
                {!!schedule.runs.length && (
                  <details className="group border-t">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-muted-foreground transition-colors select-none hover:bg-muted/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset sm:px-5 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex gap-2">
                        <span>Recent runs</span>
                        <span>{schedule.runs.length}</span>
                      </span>
                      <ChevronDown
                        className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <ol className="space-y-2 border-t px-4 py-3 sm:px-5">
                      {schedule.runs.map((run) => (
                        <li
                          key={run.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className={`size-1.5 shrink-0 rounded-full ${runStatusColor[run.status]}`}
                                aria-hidden="true"
                              />
                              <span>{runLabel[run.status]}</span>
                              <span className="text-muted-foreground">
                                {dateLabel(run.startedAt)}
                              </span>
                            </span>
                            {run.message && (
                              <p className="mt-1 max-w-xl break-words text-muted-foreground">
                                {run.message}
                              </p>
                            )}
                          </div>
                          {run.sessionId && agents.some((a) => a.id === run.sessionId) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (run.sessionId) onOpenAgent(run.sessionId);
                              }}
                            >
                              Open agent
                              <ArrowUpRight className="size-3.5" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && workspace && available && (
        <ScheduleForm
          workspace={workspace}
          {...(editing === "new" ? {} : { schedule: editing })}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{deleting.name}”?</DialogTitle>
              <DialogDescription>This can’t be undone.</DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-ui text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={!!pending}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!!pending}
                onClick={() =>
                  void act(
                    { kind: "delete", id: deleting.id, expectedRevision: deleting.revision },
                    deleting.id,
                  )
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
