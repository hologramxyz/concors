import type { AgentEvent, AgentInfo, AgentPending } from "@concors/protocol";
import type { AgentManager } from "../agents/manager.ts";
import type { WorkspaceStore } from "../workspace/store.ts";

interface Watch {
  id: string;
  supervisorId: string;
  sessionId: string;
  enabled: boolean;
}

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
  constructor(
    store: WorkspaceStore,
    agents: AgentManager,
    source: (id: string) => AgentInfo,
    target: (id: string) => AgentInfo,
  ) {
    this.store = store;
    this.agents = agents;
    this.source = source;
    this.target = target;
    store.keepAgents(() => this.records().map((w) => w.sessionId));
  }
  private records(): Watch[] {
    return (this.store.supervisorRecords("watch:") as Watch[]).filter((watch) => {
      if (!watch.enabled) return false;
      try {
        this.target(watch.sessionId);
        return true;
      } catch {
        // Removed workspaces must not consume the bounded watch slots forever.
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
  track(supervisorId: string, sessionId: string, id: string, publishCurrent = false): void {
    const target = this.target(sessionId);
    const key = this.key(supervisorId, sessionId);
    const existing = this.store.supervisorRecord(key) as Watch | undefined;
    const watch: Watch = existing?.enabled
      ? existing
      : { supervisorId, sessionId, id, enabled: true };
    if (!existing?.enabled) {
      if (this.records().length >= 64)
        throw new Error("Stop watching a chat before watching more.");
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
    const reports = () => ids.map((id) => sessionReport(this.store, this.target(id)));
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
