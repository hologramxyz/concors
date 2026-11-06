import { useContext, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgents } from "@/agents/context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { useHomePath } from "@/workspace/home-path";
import { useSchedules } from "./use-schedules";
import { days, parseTime, timeLabel } from "./schedule-labels";
import { ScheduleSelect } from "./schedule-select";
const repeatOptions = [
  { value: "interval", label: "On an interval" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
] as const;
/**
 * Creates or edits a schedule. On a computer it is a dialog over the schedule list; on a phone it
 * is a page of its own in place of the list, as a bottom sheet left the form a few fields tall
 * once the keyboard was up. The page does not focus a field on arrival, so the whole form shows
 * before the keyboard does.
 */
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
    compact = useContext(CompactLayoutContext),
    pageRef = useRef<HTMLFormElement>(null),
    homePath = useHomePath(),
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
  // The native time input draws "09:00 AM", which matches nothing else on the page. `null` while
  // the field shows `time` as it is written everywhere; text only while someone is typing.
  const [typedTime, setTypedTime] = useState<string | null>(null);
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
  const projects = workspace.projects.filter((p) => p.directory);
  // Opened from further down the list, the page starts at its top.
  useEffect(() => {
    if (compact) pageRef.current?.scrollIntoView({ block: "start" });
  }, [compact]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const at = typedTime === null ? time : parseTime(typedTime);
    if (cadence !== "interval" && !at) {
      setError(`Enter a time like ${timeLabel("09:00")}`);
      return;
    }
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
              time: at,
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
  };
  const title = schedule ? "Edit schedule" : "New schedule";
  const fields = (
    <fieldset disabled={pending} className="min-w-0 space-y-4 text-ui">
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
        <ScheduleSelect
          label="Workspace"
          value={projectId}
          placeholder={projects[0]?.name}
          options={projects.map((p) => ({
            value: p.id,
            label: <span className="truncate">{p.name}</span>,
            tooltip: p.directory ? homePath(p.directory) : undefined,
          }))}
          onChange={(next) => {
            setProjectId(next);
            setTarget("new");
          }}
        />
        <ScheduleSelect
          label="Agent session"
          value={target}
          placeholder="New dedicated session"
          options={[
            { value: "new", label: "New dedicated session" },
            ...agents
              .filter((a) => a.projectId === projectId)
              .map((a) => ({
                value: a.id,
                label: (
                  <>
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {a.providerLabel ?? a.provider}
                    </span>
                  </>
                ),
              })),
          ]}
          onChange={setTarget}
        />
      </div>
      {target === "new" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ScheduleSelect
            label="Provider"
            value={provider}
            disabled={loading}
            placeholder={
              <span className="truncate text-muted-foreground">
                {loading ? "Loading providers…" : "Choose a provider"}
              </span>
            }
            options={providers.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(next) => {
              setProvider(next);
              setModel("");
            }}
          />
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
      ) : null}
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
        <ScheduleSelect
          label="Repeat"
          value={cadence}
          placeholder="Daily"
          options={repeatOptions}
          onChange={setCadence}
        />
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
              value={typedTime ?? timeLabel(time)}
              onChange={(e) => setTypedTime(e.target.value)}
              onBlur={() => {
                const typed = typedTime === null ? null : parseTime(typedTime);
                if (!typed) return;
                setTime(typed);
                setTypedTime(null);
              }}
              placeholder={timeLabel("09:00")}
              autoComplete="off"
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
      <label className="flex min-h-9 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-foreground"
        />
        Enable schedule
      </label>
    </fieldset>
  );
  const alert = error && (
    <p role="alert" className="text-ui text-destructive">
      {error}
    </p>
  );
  const cancel = (
    <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
      Cancel
    </Button>
  );
  const save = (
    <Button type="submit" disabled={pending || !projectId || (target === "new" && !provider)}>
      {pending ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
    </Button>
  );
  if (compact)
    return (
      <form
        ref={pageRef}
        aria-label={title}
        className="mobile-form-page mx-auto flex min-h-full w-full max-w-xl flex-col gap-5 px-4 pt-3 pb-6"
        onSubmit={submit}
      >
        <div>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
            className="-ml-2"
          >
            <ArrowLeft />
            Schedules
          </Button>
          <h2 className="mt-3 text-xl font-semibold">{title}</h2>
        </div>
        {fields}
        {alert}
        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          {cancel}
          {save}
        </div>
      </form>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {/* Its form scrolls, so a tall one keeps its title and buttons in the window. */}
      <DialogContent className="overflow-hidden" aria-describedby={undefined}>
        <form className="flex min-h-0 flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="chat-scroll -m-1 min-h-0 overflow-y-auto overscroll-contain p-1">
            {fields}
          </div>
          {alert}
          <DialogFooter>
            {cancel}
            {save}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
