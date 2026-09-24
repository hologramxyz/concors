import { randomUUID } from "node:crypto";
import {
  ScheduleRequestSchema,
  type AgentInfo,
  type AgentSchedule,
  type ScheduleDefinition,
  type ScheduleRequest,
  type ScheduleResult,
  type ScheduleRun,
} from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";
import type { AgentManager } from "../agents/manager.ts";
import type { ProviderRegistry } from "../agents/providers/registry.ts";
import type { ScheduleStore } from "./store.ts";
import { nextRun } from "./cadence.ts";

const active = (run?: ScheduleRun) => run?.status === "running" || run?.status === "needs_input";
const busy = (agent: AgentInfo) =>
  ["starting", "working", "needs_input"].includes(agent.status) ||
  !!agent.queue?.length ||
  !!agent.pending.length;

export class ScheduleManager {
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private dispatching = new Set<string>();
  private jobs = new Set<Promise<void>>();
  private readonly store: ScheduleStore;
  private readonly workspace: WorkspaceStore;
  private readonly agents: Pick<AgentManager, "request" | "startScheduled">;
  private readonly providers: Pick<ProviderRegistry, "config" | "installed">;
  private readonly changed: (schedules: AgentSchedule[]) => void;
  private readonly clock: () => Date;
  constructor(
    store: ScheduleStore,
    workspace: WorkspaceStore,
    agents: Pick<AgentManager, "request" | "startScheduled">,
    providers: Pick<ProviderRegistry, "config" | "installed">,
    changed: (schedules: AgentSchedule[]) => void,
    clock: () => Date = () => new Date(),
  ) {
    this.store = store;
    this.workspace = workspace;
    this.agents = agents;
    this.providers = providers;
    this.changed = changed;
    this.clock = clock;
    // A crash can occur after delivery but before the receipt is updated. Never replay it.
    for (const schedule of store.list()) {
      let interrupted = false;
      for (const run of schedule.runs)
        if (active(run)) {
          run.status = "interrupted";
          run.finishedAt = this.now();
          run.message = "Machine restarted. This run was not resent.";
          interrupted = true;
        }
      if (interrupted) this.save(schedule);
    }
  }
  private now() {
    return this.clock().toISOString();
  }
  list() {
    return this.store.list();
  }
  start() {
    this.timer ??= setInterval(() => this.tick(), 5000);
    this.timer.unref();
    this.tick();
  }
  private save(schedule: AgentSchedule) {
    this.store.save({
      ...schedule,
      revision: (this.list().find((s) => s.id === schedule.id)?.revision ?? schedule.revision) + 1,
      updatedAt: this.now(),
    });
  }
  private publish() {
    this.changed(this.list());
  }
  private validate(value: ScheduleDefinition) {
    const project = this.workspace.snapshot().projects.find((p) => p.id === value.projectId);
    if (!project?.directory) throw new Error("Choose a workspace with a project folder");
    if (value.target.kind === "session") {
      if (this.workspace.agent(value.target.sessionId).projectId !== value.projectId)
        throw new Error("The agent must belong to this workspace");
    } else {
      const config = this.providers.config(value.target.provider);
      if (!config.enabled || !this.providers.installed(config))
        throw new Error("This provider is not installed and enabled on this machine");
    }
  }
  request(raw: ScheduleRequest, source: "user" | "agent" = "user"): ScheduleResult {
    const request = ScheduleRequestSchema.parse(raw);
    let dispatch: { schedule: AgentSchedule; run: ScheduleRun } | undefined;
    try {
      if (this.closed) throw new Error("Machine is shutting down");
      const receipt = this.store.receipt(request);
      if (receipt)
        return {
          ...receipt,
          ...(receipt.outcome.status === "ok"
            ? { outcome: { status: "ok", schedules: this.list() } }
            : {}),
        };
      const result = this.store.transaction((): ScheduleResult => {
        const op = request.operation,
          schedules = this.list();
        if (op.kind === "create") {
          if (schedules.length >= 64) throw new Error("Schedule limit reached (64)");
          this.validate(op.schedule);
          const now = this.now();
          this.store.save({
            ...op.schedule,
            id: randomUUID(),
            revision: 0,
            source,
            createdAt: now,
            updatedAt: now,
            nextRunAt: op.schedule.enabled ? nextRun(op.schedule.cadence, this.clock()) : null,
            sessionId: op.schedule.target.kind === "session" ? op.schedule.target.sessionId : null,
            runs: [],
          });
        } else if (op.kind !== "list") {
          const schedule = schedules.find((s) => s.id === op.id);
          if (!schedule) throw new Error("Schedule no longer exists");
          if (op.kind === "run") {
            if (schedule.runs.some(active) || this.dispatching.has(schedule.id))
              throw new Error("This schedule already has an active run");
            const run = this.claim(schedule, this.now(), false);
            dispatch = { schedule, run };
          } else {
            if (schedule.revision !== op.expectedRevision)
              throw new Error("Schedule changed. Review the latest version and try again.");
            if (op.kind === "delete") {
              if (schedule.runs.some(active))
                throw new Error("Stop the agent before deleting a running schedule");
              this.store.remove(schedule.id);
            } else {
              if (op.schedule.enabled) this.validate(op.schedule);
              const targetChanged =
                schedule.projectId !== op.schedule.projectId ||
                JSON.stringify(schedule.target) !== JSON.stringify(op.schedule.target);
              if (targetChanged && schedule.runs.some(active))
                throw new Error("Stop the agent before changing its schedule target");
              const cadenceChanged =
                JSON.stringify(schedule.cadence) !== JSON.stringify(op.schedule.cadence);
              this.save({
                ...schedule,
                ...op.schedule,
                sessionId: targetChanged
                  ? op.schedule.target.kind === "session"
                    ? op.schedule.target.sessionId
                    : null
                  : schedule.sessionId,
                nextRunAt: !op.schedule.enabled
                  ? null
                  : !schedule.enabled || cadenceChanged
                    ? nextRun(op.schedule.cadence, this.clock())
                    : schedule.nextRunAt,
              });
            }
          }
        }
        const result: ScheduleResult = {
          type: "schedule.result",
          requestId: request.requestId,
          outcome: { status: "ok", schedules: this.list() },
        };
        if (op.kind !== "list") this.store.remember(request, result);
        return result;
      });
      this.publish();
      if (dispatch) this.dispatch(dispatch.schedule, dispatch.run);
      return result;
    } catch (error) {
      return {
        type: "schedule.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: error instanceof Error ? error.message : "Could not update schedule",
        },
      };
    }
  }
  private claim(
    schedule: AgentSchedule,
    scheduledAt: string,
    advance: boolean,
    skipped?: string,
  ): ScheduleRun {
    const run: ScheduleRun = {
      id: randomUUID(),
      scheduledAt,
      startedAt: this.now(),
      finishedAt: skipped ? this.now() : null,
      sessionId: schedule.sessionId,
      turnId: null,
      status: skipped ? "skipped" : "running",
      message: skipped ?? null,
    };
    if (advance) schedule.nextRunAt = nextRun(schedule.cadence, this.clock());
    const history = [run, ...schedule.runs];
    const running = history.filter(active);
    const retained = new Set(
      [...running, ...history.filter((r) => !active(r)).slice(0, 20 - running.length)].map(
        (r) => r.id,
      ),
    );
    schedule.runs = history.filter((r) => retained.has(r.id));
    this.save(schedule);
    return run;
  }
  /** Settle on the native state event, before a user can start another turn in the session. */
  observe(agent: AgentInfo) {
    if (this.closed) return;
    for (const schedule of this.list()) {
      let changed = false;
      for (const run of schedule.runs) {
        if (!active(run) || run.sessionId !== agent.id || !run.turnId) continue;
        const actualTurn =
          this.workspace.agentItem(agent.id, `prompt:${run.id}`)?.turnId ?? run.turnId;
        if (actualTurn !== agent.turnId) continue;
        const status =
          agent.status === "needs_input"
            ? "needs_input"
            : agent.status === "working" || agent.status === "starting"
              ? "running"
              : agent.status === "idle"
                ? "done"
                : agent.status;
        if (run.status !== status || run.turnId !== actualTurn) {
          run.status = status;
          run.turnId = actualTurn;
          if (!active(run)) {
            run.finishedAt = this.now();
            run.message = agent.error;
          }
          changed = true;
        }
      }
      if (changed) {
        this.save(schedule);
        this.publish();
      }
    }
  }
  /** Called even with no connected clients. Advance due time before launching any provider. */
  tick() {
    if (this.closed) return;
    for (const schedule of this.list()) {
      let changed = false;
      for (const run of schedule.runs) {
        if (!active(run) || !run.sessionId || this.dispatching.has(schedule.id)) continue;
        const agent = this.workspace.agents().find((a) => a.id === run.sessionId);
        if (!agent) {
          run.status = "failed";
          run.message = "Agent session was removed";
        } else if (agent.status === "needs_input") {
          if (run.status !== "needs_input") {
            run.status = "needs_input";
            changed = true;
          }
          continue;
        } else if (agent.status === "working" || agent.status === "starting") {
          if (run.status !== "running") {
            run.status = "running";
            changed = true;
          }
          continue;
        } else {
          run.status = agent.status === "idle" ? "done" : agent.status;
          run.message = agent.error;
        }
        run.finishedAt = this.now();
        changed = true;
      }
      if (changed) {
        this.save(schedule);
        this.publish();
      }
      if (!schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt > this.now()) continue;
      const scheduledAt = schedule.nextRunAt;
      // Do not let an overdue tick hide an earlier run still waiting for input.
      if (schedule.runs.some(active) || this.dispatching.has(schedule.id)) {
        this.store.transaction(() =>
          this.claim(
            schedule,
            scheduledAt,
            true,
            "Previous run is still active or waiting for input",
          ),
        );
        this.publish();
        continue;
      }
      const agent = this.workspace.agents().find((a) => a.id === schedule.sessionId);
      const skipped =
        Date.parse(this.now()) - Date.parse(schedule.nextRunAt) > 90000
          ? "Machine was offline at the scheduled time. Missed runs are not replayed."
          : agent && busy(agent)
            ? "Agent is busy or waiting for input"
            : undefined;
      const run = this.store.transaction(() => this.claim(schedule, scheduledAt, true, skipped));
      this.publish();
      if (!skipped) this.dispatch(schedule, run);
    }
  }
  private patchRun(id: string, runId: string, patch: Partial<ScheduleRun>, sessionId?: string) {
    const schedule = this.list().find((s) => s.id === id);
    if (!schedule) return;
    if (sessionId) schedule.sessionId = sessionId;
    schedule.runs = schedule.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r));
    this.save(schedule);
    this.publish();
  }
  private dispatch(schedule: AgentSchedule, run: ScheduleRun) {
    this.dispatching.add(schedule.id);
    const job = this.deliver(schedule, run).finally(() => {
      this.dispatching.delete(schedule.id);
      this.jobs.delete(job);
      const sessionId = this.list().find((s) => s.id === schedule.id)?.sessionId;
      const agent = this.workspace.agents().find((a) => a.id === sessionId);
      if (agent) this.observe(agent);
    });
    this.jobs.add(job);
  }
  private async deliver(schedule: AgentSchedule, run: ScheduleRun) {
    try {
      let sessionId = schedule.sessionId;
      if (!sessionId && schedule.target.kind === "agent") {
        // Persist the session identity before async provider startup, including failed startup.
        sessionId = randomUUID();
        this.patchRun(schedule.id, run.id, { sessionId }, sessionId);
        await this.agents.startScheduled(
          sessionId,
          schedule.projectId,
          schedule.target.provider,
          schedule.target.model,
        );
      }
      if (!sessionId) throw new Error("Agent session is unavailable");
      if (this.closed) throw new Error("Machine is shutting down");
      let info = this.workspace.agents().find((a) => a.id === sessionId);
      if (!info && schedule.target.kind === "agent")
        info = await this.agents.startScheduled(
          sessionId,
          schedule.projectId,
          schedule.target.provider,
          schedule.target.model,
        );
      if (!info) throw new Error("Agent session was removed");
      if (busy(info)) {
        this.patchRun(schedule.id, run.id, {
          status: "skipped",
          message: "Agent is busy or waiting for input",
          finishedAt: this.now(),
        });
        return;
      }
      // Resume the saved provider if needed; never silently start a new conversation.
      await this.agents.startScheduled(sessionId, schedule.projectId, info.provider, info.model);
      if (this.closed) throw new Error("Machine is shutting down");
      if (busy(this.workspace.agent(sessionId))) {
        this.patchRun(schedule.id, run.id, {
          status: "skipped",
          message: "Agent is busy or waiting for input",
          finishedAt: this.now(),
        });
        return;
      }
      const result = await this.agents.request(
        {
          type: "agent.request",
          requestId: run.id,
          operation: { kind: "send", sessionId, text: schedule.prompt },
        },
        "schedule",
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      this.patchRun(
        schedule.id,
        run.id,
        { sessionId, turnId: result.outcome.conversation.agent.turnId },
        sessionId,
      );
    } catch (error) {
      this.patchRun(schedule.id, run.id, {
        status: "failed",
        message: (error instanceof Error ? error.message : "Could not start agent").slice(0, 1000),
        finishedAt: this.now(),
      });
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.jobs);
    this.store.close();
  }
}
