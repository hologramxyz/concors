import type { AgentEvent, AgentInfo, AgentPending } from "@concors/protocol";
import type { AgentManager } from "../agents/manager.ts";
import type { WorkspaceStore } from "../workspace/store.ts";

interface Watch {
  id: string;
  supervisorId: string;
  sessionId: string;
  enabled: boolean;
  /** Asked for with the watch operation, rather than started by sending or waiting. */
  explicit?: boolean;
  pending?: { id: string; turnId: string; kind: AgentPending["kind"]; action: string }[];
}
/** Each Supervisor conversation may follow this many chats at once. */
export const WATCH_LIMIT = 64;

const terminal = (agent: AgentInfo) => ["done", "failed", "interrupted"].includes(agent.status);
const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => "> " + line)
    .join("\n");
/** The approval body may contain a whole generated file; show the action, not its source code. */
function pendingAction(pending: AgentPending): string {
  if (pending.kind === "questions")
    return pending.questions
      .map((q) => q.question)
      .join("\n")
      .slice(0, 1000);
  try {
    const detail = JSON.parse(pending.detail) as { command?: string; reason?: string };
    const input = JSON.parse((detail.command ?? pending.summary).split("\n")[0] ?? "") as {
      file_path?: string;
      command?: string;
    };
    if (input.file_path)
      return `${detail.reason ?? "File operation"} ${input.file_path.split(/[\\/]/).at(-1)}`;
    if (input.command) return input.command.slice(0, 1000);
  } catch {
    /* Older adapters supply a plain command or question. */
  }
  return (pending.summary || pending.detail || pending.title).slice(0, 1000);
}

const pendingSummary = (pending: AgentPending) => ({
  id: pending.id,
  kind: pending.kind,
  title: pending.title.slice(0, 240),
  summary: pendingAction(pending),
  detail: pending.detail.slice(0, 2000),
});

/** Local saved context only. This never launches or prompts an agent for progress. */
export function sessionReport(store: WorkspaceStore, agent: AgentInfo, includeReply = true) {
  const snapshot = store.snapshot();
  const project = [...snapshot.projects, ...(snapshot.closedProjects ?? [])].find(
    (p) => p.id === agent.projectId,
  );
  const reply =
    includeReply && agent.turnId
      ? store
          .agentTurnItems(agent.id, agent.turnId)
          .findLast((item) => item.kind === "assistant" && item.presentation?.type !== "thinking")
      : undefined;
  return {
    sessionId: agent.id,
    projectId: agent.projectId,
    workspace: project?.name ?? "Workspace",
    name: agent.paneName ?? agent.tabName ?? agent.name,
    provider: agent.provider,
    status: agent.status,
    turnId: agent.turnId,
    queued: agent.queue?.length ?? 0,
    queuePaused: agent.queuePaused ?? false,
    pending: agent.pending.map(pendingSummary),
    permissions: agent.settings?.mode ?? "default",
    error: agent.error,
    reply: reply
      ? { text: reply.text.slice(0, 12000), truncated: reply.text.length > 12000 }
      : null,
  };
}

/** Durable chat subscriptions; a bounded wait lets a running Supervisor coordinate dependent work. */
export class SupervisorWatches {
  private closed = false;
  private readonly waiters = new Set<{ ids: Set<string>; wake: () => void }>();
  private readonly store: WorkspaceStore;
  private readonly agents: AgentManager;
  private readonly source: (id: string) => AgentInfo;
  private readonly target: (id: string) => AgentInfo;
  private readonly delivering: (supervisorId: string, sessionId: string) => boolean;
  private readonly selected: () => Set<string>;
  constructor(
    store: WorkspaceStore,
    agents: AgentManager,
    source: (id: string) => AgentInfo,
    target: (id: string) => AgentInfo,
    /** Whether this Supervisor still has an unfinished delivery to the chat. */
    delivering: (supervisorId: string, sessionId: string) => boolean,
    /** The Supervisor sessions the user can still return to: the shown one and its other harnesses. */
    selected: () => Set<string>,
  ) {
    this.store = store;
    this.agents = agents;
    this.source = source;
    this.target = target;
    this.delivering = delivering;
    this.selected = selected;
    // Only work still in flight for a Supervisor the user can return to keeps a chat from being
    // retired. Finished or orphaned watches must not pin chats past the machine's chat limit.
    store.keepAgents(() => {
      const selected = this.selected();
      return this.records()
        .filter((watch) => selected.has(watch.supervisorId))
        .flatMap((watch) => {
          try {
            return this.settled(watch, this.target(watch.sessionId)) ? [] : [watch.sessionId];
          } catch {
            return [];
          }
        });
    });
  }
  private records(): Watch[] {
    return (this.store.supervisorRecords("watch:") as Watch[]).filter((watch) => {
      if (!watch.enabled) return false;
      try {
        this.target(watch.sessionId);
        this.store.agent(watch.supervisorId);
        return true;
      } catch {
        // A removed workspace or a retired Supervisor conversation leaves nothing to report to.
        this.store.saveSupervisorRecord(this.key(watch.supervisorId, watch.sessionId), {
          ...watch,
          enabled: false,
        });
        return false;
      }
    });
  }
  private key(source: string, target: string) {
    return `watch:${source}:${target}`;
  }
  /** Nothing is running, waiting, queued or still being delivered there for this Supervisor. */
  private settled(watch: Watch, target: AgentInfo): boolean {
    return (
      !["starting", "working", "needs_input"].includes(target.status) &&
      !target.pending.length &&
      !target.queue?.length &&
      !this.delivering(watch.supervisorId, watch.sessionId)
    );
  }
  /**
   * The limit belongs to one Supervisor conversation, so chats followed before /clear never block
   * the next one. At the limit, the settled chat idle longest makes room, preferring one only
   * followed because work was sent there; only when every followed chat is busy does this refuse.
   */
  private makeRoom(supervisorId: string): void {
    const own = this.records().filter((watch) => watch.supervisorId === supervisorId);
    if (own.length < WATCH_LIMIT) return;
    const oldest = own
      .flatMap((watch) => {
        try {
          const target = this.target(watch.sessionId);
          return this.settled(watch, target) ? [{ watch, target }] : [];
        } catch {
          return [];
        }
      })
      .sort(
        (a, b) =>
          Number(!!a.watch.explicit) - Number(!!b.watch.explicit) ||
          a.target.updatedAt.localeCompare(b.target.updatedAt),
      )[0];
    if (!oldest)
      throw new Error(
        `Supervisor already follows ${WATCH_LIMIT} chats with work in progress. Stop watching one first.`,
      );
    this.stop(supervisorId, oldest.watch.sessionId);
  }
  track(
    supervisorId: string,
    sessionId: string,
    id: string,
    publishCurrent = false,
    explicit = false,
  ): void {
    const target = this.target(sessionId);
    const key = this.key(supervisorId, sessionId);
    const existing = this.store.supervisorRecord(key) as Watch | undefined;
    let watch: Watch = existing?.enabled
      ? existing
      : { supervisorId, sessionId, id, enabled: true, ...(explicit ? { explicit } : {}) };
    if (!existing?.enabled) {
      this.makeRoom(supervisorId);
      this.store.saveSupervisorRecord(key, watch);
    } else if (explicit && !existing.explicit) {
      watch = { ...existing, explicit };
      this.store.saveSupervisorRecord(key, watch);
    }
    // Always show an existing blocker, even if the new instruction is only queued behind it.
    if (publishCurrent || target.pending.length) this.notify(watch);
  }
  stop(supervisorId: string, sessionId: string): void {
    const key = this.key(supervisorId, sessionId);
    const watch = this.store.supervisorRecord(key) as Watch | undefined;
    if (watch) this.store.saveSupervisorRecord(key, { ...watch, enabled: false });
  }
  status(supervisorId: string) {
    return this.records()
      .filter((w) => w.supervisorId === supervisorId)
      .flatMap((w) => {
        try {
          const report = sessionReport(this.store, this.target(w.sessionId));
          return [
            {
              ...report,
              reply: report.reply
                ? {
                    text: report.reply.text.slice(0, 2000),
                    truncated: report.reply.truncated || report.reply.text.length > 2000,
                  }
                : null,
            },
          ];
        } catch {
          return [];
        }
      });
  }
  async wait(supervisorId: string, ids: string[], timeoutMs: number, on: "attention" | "change") {
    // A chat can be deleted, or its workspace removed, while Supervisor waits on it. Report that
    // chat as unavailable rather than throwing: wake runs inside the daemon's event dispatch.
    const reports = () =>
      ids.map((id) => {
        try {
          return sessionReport(this.store, this.target(id));
        } catch (error) {
          return {
            sessionId: id,
            status: "unavailable" as const,
            turnId: null,
            pending: [],
            queued: 0,
            queuePaused: false,
            error: error instanceof Error ? error.message : "This chat is no longer available.",
          };
        }
      });
    const initial = reports();
    const signature = (rows: typeof initial) =>
      JSON.stringify(rows.map((r) => [r.status, r.turnId, r.pending, r.queued, r.queuePaused]));
    if (
      !initial.some(
        (r) => ["starting", "working", "needs_input"].includes(r.status) || r.pending.length,
      ) ||
      (on === "attention" && initial.some((r) => r.pending.length))
    )
      return { sessions: initial, timedOut: false };
    let timedOut = false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };
      const waiter = {
        ids: new Set(ids),
        wake: () => {
          if (this.closed || signature(reports()) !== signature(initial)) finish();
        },
      };
      const timer = setTimeout(() => {
        timedOut = true;
        finish();
      }, timeoutMs);
      this.waiters.add(waiter);
    });
    if (this.closed) throw new Error("Supervisor is shutting down");
    this.source(supervisorId); // Sharing can be withdrawn while a native tool is waiting.
    return { sessions: reports(), timedOut };
  }
  observe(event: AgentEvent): void {
    if (this.closed || (event.type !== "agent.state" && event.type !== "agent.item")) return;
    const id = event.type === "agent.state" ? event.agent.id : event.item.sessionId;
    for (const watch of this.records())
      if (watch.sessionId === id || watch.supervisorId === id)
        this.notify(
          watch,
          event.type === "agent.state" && event.agent.id === watch.sessionId
            ? event.agent
            : undefined,
        );
    if (event.type === "agent.state")
      for (const waiter of this.waiters) if (waiter.ids.has(id)) waiter.wake();
  }
  private notify(watch: Watch, observed?: AgentInfo): void {
    let target: AgentInfo;
    try {
      this.source(watch.supervisorId);
      target = this.target(watch.sessionId);
      if (observed) target = observed;
    } catch {
      return;
    }
    const report = sessionReport(this.store, target);
    const name = report.name.replaceAll("[", "").replaceAll("]", "").replaceAll("\\", "");
    const link = `[${name}](concors://session/${target.id})`;
    const prefix = `**${report.workspace} / ${link}**`;
    const pendingIds = new Set(target.pending.map((p) => p.id));
    for (const previous of watch.pending ?? []) {
      if (pendingIds.has(previous.id)) continue;
      this.record(
        watch,
        `input:${previous.turnId}:${previous.id}`,
        "Input no longer pending",
        `${prefix} is no longer waiting for that ${previous.kind === "approval" ? "approval" : "input"}.\n\n${quote(previous.action)}${target.status === "working" ? "\n\nThe agent has resumed." : ""}`,
      );
    }
    const pending = target.pending.map((p) => ({
      id: p.id,
      turnId: p.turnId,
      kind: p.kind,
      action: pendingAction(p),
    }));
    if (JSON.stringify(pending) !== JSON.stringify(watch.pending ?? []))
      this.store.saveSupervisorRecord(this.key(watch.supervisorId, watch.sessionId), {
        ...watch,
        pending,
      });
    for (const pending of target.pending) {
      const state = pending.kind === "approval" ? "needs your approval" : "needs your input";
      this.record(
        watch,
        `input:${pending.turnId}:${pending.id}`,
        "Agent needs your input",
        `${prefix} ${state}.\n\n${quote([pendingAction(pending)].filter(Boolean).join("\n").slice(0, 3000))}\n\nOpen that chat to respond.${report.queued ? ` ${report.queued} follow-up instruction(s) are queued behind it.` : ""}`,
      );
    }
    if (report.queuePaused && report.queued)
      this.record(
        watch,
        `paused:${target.turnId}:${target.queue?.map((q) => q.id).join(":")}`,
        "Queued work paused",
        `${prefix} has ${report.queued} paused instruction(s).\n\n${quote(target.error ?? "Open the target chat to review its queue before resuming.")}`,
      );
    if (!terminal(target) || !target.turnId || target.pending.length) return;
    const result = report.reply?.text.slice(0, 3000);
    const outcome = target.status === "done" ? "finished" : target.status;
    this.record(
      watch,
      `${target.turnId}:${target.status}`,
      "Agent result",
      `${prefix} ${outcome}.\n\n${result ? `Agent’s reply:\n\n${quote(result)}${report.reply?.truncated || (report.reply?.text.length ?? 0) > 3000 ? "\n\nRead the original chat for the full reply." : ""}` : target.error ? quote(target.error.slice(0, 3000)) : "No final text reply was saved. Open the chat for its tool output."}`,
    );
  }
  private record(watch: Watch, suffix: string, title: string, text: string): void {
    const id = `supervisor-watch:${watch.supervisorId}:${watch.sessionId}:${suffix}`;
    const previous = this.store.agentItem(watch.supervisorId, id);
    if (previous?.text === text) return;
    this.agents.recordSupervisorUpdate(watch.supervisorId, {
      id,
      sessionId: watch.supervisorId,
      turnId: `supervisor:${watch.id}`,
      position: 0,
      revision: 0,
      kind: "system",
      title,
      text,
      detail: "",
      status: "completed",
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      origin: { supervisorId: watch.supervisorId, deliveryId: watch.id },
    });
  }
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter.wake();
  }
}
