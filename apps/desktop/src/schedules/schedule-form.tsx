import { useState, useEffect, useId } from "react";
import type {
  AgentSchedule,
  ScheduleDefinition,
  ProviderStatus,
  WorkspaceSnapshot,
} from "@concors/protocol";
import { ScheduleDefinitionSchema } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgents } from "@/agents/context";
import { useSchedules } from "./use-schedules";
import { days } from "./schedule-labels";
const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
export function ScheduleForm({
  workspace,
  schedule,
  onClose,
}: {
  workspace: WorkspaceSnapshot;
  schedule?: AgentSchedule;
  onClose: () => void;
}) {
  const { connection } = useSchedules(),
    agents = useAgents(),
    modelListId = useId();
  const [name, setName] = useState(schedule?.name ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [projectId, setProjectId] = useState(
    schedule?.projectId ?? workspace.selection?.projectId ?? workspace.projects[0]?.id ?? "",
  );
  const [target, setTarget] = useState(
    schedule?.target.kind === "session" ? schedule.target.sessionId : "new",
  );
  const [provider, setProvider] = useState(
    schedule?.target.kind === "agent" ? schedule.target.provider : "",
  );
  const [model, setModel] = useState(
    schedule?.target.kind === "agent" ? (schedule.target.model ?? "") : "",
  );
  const [cadence, setCadence] = useState(schedule?.cadence.kind ?? "daily");
  const [minutes, setMinutes] = useState(
    schedule?.cadence.kind === "interval" ? schedule.cadence.minutes : 60,
  );
  const [time, setTime] = useState(
    schedule?.cadence.kind !== "interval" ? (schedule?.cadence.time ?? "09:00") : "09:00",
  );
  const [timezone, setTimezone] = useState(
    schedule?.cadence.kind !== "interval"
      ? (schedule?.cadence.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [weekdays, setWeekdays] = useState(
    schedule?.cadence.kind === "weekly" ? schedule.cadence.days : [1, 2, 3, 4, 5],
  );
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!connection) return;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((result) => {
        if (!current) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const installed = result.outcome.providers.filter((p) => p.enabled && p.installed);
        setProviders(installed);
        setProvider((value) => value || installed[0]?.id || "");
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not load providers");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [connection]);
  const suggestions = [
    ...new Set([
      ...(providers.find((p) => p.id === provider)?.models ?? []),
      ...agents
        .filter((a) => a.provider === provider)
        .flatMap((a) => (a.models ?? []).map((m) => m.id)),
    ]),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const value = ScheduleDefinitionSchema.safeParse({
              name,
              prompt,
              projectId,
              enabled,
              target:
                target === "new"
                  ? { kind: "agent", provider, model: model.trim() || null }
                  : { kind: "session", sessionId: target },
              cadence:
                cadence === "interval"
                  ? { kind: cadence, minutes }
                  : {
                      kind: cadence,
                      time,
                      timezone,
                      ...(cadence === "weekly" ? { days: weekdays } : {}),
                    },
            });
            if (!value.success) {
              setError(value.error.issues[0]?.message ?? "Check the schedule fields");
              return;
            }
            if (!connection) {
              setError("Machine is disconnected");
              return;
            }
            const definition: ScheduleDefinition = value.data;
            setPending(true);
            void connection
              .requestSchedule(
                schedule
                  ? {
                      kind: "update",
                      id: schedule.id,
                      expectedRevision: schedule.revision,
                      schedule: definition,
                    }
                  : { kind: "create", schedule: definition },
                crypto.randomUUID(),
              )
              .then((result) => {
                if (result.outcome.status === "error") throw new Error(result.outcome.message);
                onClose();
              })
              .catch((cause) =>
                setError(cause instanceof Error ? cause.message : "Could not save schedule"),
              )
              .finally(() => setPending(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
            <DialogDescription>
              Run a prompt on this machine, even when the client is closed.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={pending} className="my-5 space-y-4 text-ui">
            <label className="block space-y-1.5">
              <span>Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Daily code review"
                maxLength={100}
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span>Workspace</span>
                <select
                  className={selectClass}
                  value={projectId}
                  required
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setTarget("new");
                  }}
                >
                  {workspace.projects
                    .filter((p) => p.directory)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span>Agent session</span>
                <select
                  className={selectClass}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="new">New dedicated session</option>
                  {agents
                    .filter((a) => a.projectId === projectId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.providerLabel ?? a.provider}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {target === "new" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span>Provider</span>
                  <select
                    className={selectClass}
                    value={provider}
                    required
                    disabled={loading}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setModel("");
                    }}
                  >
                    <option value="" disabled>
                      {loading ? "Loading providers…" : "Choose a provider"}
                    </option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span>Model</span>
                  <Input
                    list={modelListId}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Provider default"
                    maxLength={1024}
                  />
                  <datalist id={modelListId}>
                    {suggestions.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </label>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Uses this session’s current model and approval settings. Busy sessions are skipped.
              </p>
            )}
            {target === "new" && (
              <p className="text-muted-foreground">
                Choose a known model or enter its ID. The schedule reuses its session after the
                first run.
              </p>
            )}
            {!loading && !providers.length && target === "new" && (
              <p role="status">Sign in to Codex, Claude Code or OpenCode on this machine first.</p>
            )}
            <label className="block space-y-1.5">
              <span>Prompt</span>
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={16000}
                placeholder="Review recent commits and summarize anything that needs attention."
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span>Repeat</span>
                <select
                  className={selectClass}
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as typeof cadence)}
                >
                  <option value="interval">On an interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {cadence === "interval" ? (
                <label className="block space-y-1.5">
                  <span>Every (minutes)</span>
                  <Input
                    type="number"
                    min={15}
                    max={43200}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    required
                  />
                </label>
              ) : (
                <label className="block space-y-1.5">
                  <span>At</span>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                </label>
              )}
            </div>
            {cadence === "weekly" && (
              <fieldset>
                <legend className="mb-2">On these days</legend>
                <div className="flex flex-wrap gap-1">
                  {days.map((day, i) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={weekdays.includes(i) ? "default" : "outline"}
                      aria-pressed={weekdays.includes(i)}
                      onClick={() =>
                        setWeekdays((v) => (v.includes(i) ? v.filter((d) => d !== i) : [...v, i]))
                      }
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            {cadence !== "interval" && (
              <label className="block space-y-1.5">
                <span>Time zone</span>
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/Los_Angeles"
                  required
                />
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-foreground"
              />
              Enable schedule
            </label>
            <p className="text-muted-foreground">
              The machine must stay on. Missed runs aren’t replayed. Tool approvals may need your
              input.
            </p>
          </fieldset>
          {error && (
            <p role="alert" className="mb-4 text-ui text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !projectId || (target === "new" && !provider)}
            >
              {pending ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
