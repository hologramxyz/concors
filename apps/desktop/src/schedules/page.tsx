import { CalendarClock, Plus, Play, Pause, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import {
  SCHEDULES_CAPABILITY,
  type AgentSchedule,
  type ScheduleOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
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

export function SchedulesPage({
  workspace,
  connected,
  onOpenAgent,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
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
          <h2 className="text-xl font-semibold">Schedules</h2>
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
        <p role="status" className="my-16 text-center text-ui text-muted-foreground">
          {!connected
            ? "Connect to a machine to manage its schedules."
            : !supported
              ? "Update the daemon on this machine to use schedules."
              : "Loading schedules…"}
        </p>
      ) : !schedules.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="flex size-14 items-center justify-center rounded-xl border bg-muted/40">
            <CalendarClock className="size-6 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-medium">No schedules yet</h3>
            <p className="mt-2 max-w-sm text-ui leading-relaxed text-muted-foreground">
              Schedules run agents on a cadence. Set up a prompt here, or ask an agent to create a
              Concors schedule.
            </p>
          </div>
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
            const last = schedule.runs[0];
            const active = schedule.runs.some(
              (r) => r.status === "running" || r.status === "needs_input",
            );
            const agent = agents.find((a) => a.id === schedule.sessionId);
            return (
              <article
                key={schedule.id}
                className="rounded-lg border bg-background p-4 text-ui sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium break-words">{schedule.name}</h3>
                      <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {schedule.enabled ? "Active" : "Paused"}
                      </span>
                      {last && (
                        <span className="text-xs text-muted-foreground" role="status">
                          {runLabel[last.status]}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 break-words text-muted-foreground">
                      {project?.name ?? "Workspace unavailable"} ·{" "}
                      {agent?.providerLabel ??
                        (schedule.target.kind === "agent"
                          ? schedule.target.provider
                          : "Existing agent")}
                      {schedule.source === "agent" ? " · Created by agent" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Run now"
                      aria-label={`Run ${schedule.name} now`}
                      disabled={!available || !!pending || active}
                      onClick={() => void act({ kind: "run", id: schedule.id }, schedule.id)}
                    >
                      <Play className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title={schedule.enabled ? "Pause" : "Resume"}
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
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Edit"
                      aria-label={`Edit ${schedule.name}`}
                      disabled={!available || !!pending}
                      onClick={() => setEditing(schedule)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      aria-label={`Delete ${schedule.name}`}
                      disabled={!available || !!pending || active}
                      onClick={() => setDeleting(schedule)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 break-words whitespace-pre-wrap text-muted-foreground">
                  {schedule.prompt}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-muted-foreground">
                  <span>{cadenceLabel(schedule.cadence)}</span>
                  <span>
                    {schedule.nextRunAt
                      ? `Next ${dateLabel(schedule.nextRunAt)}`
                      : "No upcoming runs"}
                  </span>
                </div>
                {!!schedule.runs.length && (
                  <details className="mt-4 border-t pt-3">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Recent runs · {schedule.runs.length}
                    </summary>
                    <ol className="mt-3 space-y-3">
                      {schedule.runs.map((run) => (
                        <li
                          key={run.id}
                          className="flex flex-wrap items-start justify-between gap-2"
                        >
                          <div>
                            <span>
                              {runLabel[run.status]} · {dateLabel(run.startedAt)}
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
                              onClick={() => onOpenAgent(run.sessionId!)}
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
      {available && !!schedules.length && (
        <p className="mt-6 text-ui leading-relaxed text-muted-foreground">
          Schedules belong to this machine. Keep it running; busy and missed runs are skipped.
          Next-run times are shown in your device’s time zone.
        </p>
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
              <DialogTitle>Delete {deleting.name}?</DialogTitle>
              <DialogDescription>
                This removes the schedule and its run history. The agent conversation remains
                available.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-ui text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={!!pending} onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!!pending}
                onClick={() =>
                  void act(
                    { kind: "delete", id: deleting.id, expectedRevision: deleting.revision },
                    deleting.id,
                  )
                }
              >
                Delete schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
