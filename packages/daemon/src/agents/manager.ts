import { normalizeCommandExecutionCommand } from "./codex/command-display.ts";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  AgentQuestionSchema,
  type AgentInfo,
  type AgentItem,
  type AgentEvent,
  type AgentPending,
  type AgentRequest,
  type AgentResult,
} from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";
import { resolveProfile } from "../terminal/profiles.ts";
import { CodexAppServer } from "./codex/app-server.ts";
import { mapCodexItem } from "./codex/items.ts";

export type AgentProvider = Pick<
  CodexAppServer,
  "initialize" | "request" | "onNotification" | "onFailure" | "close"
>;
export type AgentProviderFactory = (
  directory: string,
  onRequest: (method: string, params: unknown, id: string | number) => Promise<unknown>,
) => AgentProvider;
const createProvider: AgentProviderFactory = (cwd, onRequest) => {
  const profile = resolveProfile("codex");
  const args =
    typeof profile.args === "string"
      ? [
          "/d",
          "/s",
          "/c",
          profile.args.slice("/d /s /c ".length, -1) + ' app-server --listen stdio://"',
        ]
      : ["app-server", "--listen", "stdio://"];
  return new CodexAppServer(
    spawn(profile.command, args, {
      cwd,
      stdio: "pipe",
      windowsHide: true,
      ...(typeof profile.args === "string" ? { windowsVerbatimArguments: true } : {}),
    }),
    onRequest,
  );
};
const ObjectValue = z.record(z.string(), z.unknown());
const Turn = z.object({
  id: z.string(),
  status: z.string(),
  items: z.array(z.unknown()).default([]),
  error: z.object({ message: z.string() }).nullable().optional(),
});
const ThreadResponse = z.object({
  thread: z.object({ id: z.string(), turns: z.array(Turn).default([]) }),
  model: z.string().optional(),
});
const Scope = z.object({ threadId: z.string(), turnId: z.string() });
interface PendingResolver {
  providerId: string | number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}
interface Runtime {
  provider: AgentProvider;
  ready: Promise<AgentProvider>;
  pending: Map<string, PendingResolver>;
  closed: boolean;
}

export class AgentManager {
  readonly #store: WorkspaceStore;
  readonly #emit: (event: AgentEvent) => void;
  readonly #workspaceChanged: () => void;
  readonly #factory: AgentProviderFactory;
  readonly #runtimes = new Map<string, Runtime>();
  #closed = false;
  constructor(
    store: WorkspaceStore,
    emit: (event: AgentEvent) => void,
    workspaceChanged: () => void,
    factory: AgentProviderFactory = createProvider,
  ) {
    this.#store = store;
    this.#emit = emit;
    this.#workspaceChanged = workspaceChanged;
    this.#factory = factory;
    for (const info of store.agents())
      if (["starting", "working", "needs_input"].includes(info.status)) {
        store.saveAgent({
          ...info,
          status: "interrupted",
          pending: [],
          error:
            "The daemon restarted. Your saved conversation can be continued; the previous prompt will not be resent.",
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        });
      }
  }
  private update(id: string, patch: Partial<AgentInfo>): AgentInfo {
    const prior = this.#store.agent(id);
    const next = {
      ...prior,
      ...patch,
      revision: prior.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.#store.saveAgent(next);
    this.#emit({ type: "agent.state", agent: next });
    return next;
  }
  private item(
    id: string,
    turnId: string,
    value: Pick<AgentItem, "id" | "kind" | "title" | "text" | "detail" | "status">,
  ): void {
    const previous = this.#store.agentItem(id, value.id);
    const item = this.#store.saveAgentItem({
      ...value,
      sessionId: id,
      turnId,
      position: previous?.position ?? 0,
      revision: previous?.revision ?? 0,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    });
    this.#emit({ type: "agent.item", item });
  }
  private fail(id: string, error: unknown): void {
    if (this.#closed) return;
    const runtime = this.#runtimes.get(id);
    if (runtime) {
      runtime.closed = true;
      for (const pending of runtime.pending.values())
        pending.reject(new Error("Agent connection ended"));
      runtime.pending.clear();
      this.#runtimes.delete(id);
      void runtime.provider.close();
    }
    this.update(id, {
      status: "failed",
      pending: [],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
    });
  }
  private provider(id: string): Promise<AgentProvider> {
    const existing = this.#runtimes.get(id);
    if (existing) return existing.ready;
    if (this.#closed) return Promise.reject(new Error("Daemon is shutting down"));
    if (this.#runtimes.size >= 8) {
      const idle = [...this.#runtimes].find(([key]) =>
        ["idle", "done", "failed", "interrupted"].includes(this.#store.agent(key).status),
      );
      if (!idle) return Promise.reject(new Error("Up to eight agents can run at once"));
      idle[1].closed = true;
      this.#runtimes.delete(idle[0]);
      void idle[1].provider.close();
    }
    const info = this.#store.agent(id);
    const provider = this.#factory(info.directory, (method, params, requestId) =>
      this.approval(id, method, params, requestId),
    );
    const runtime: Runtime = {
      provider,
      ready: Promise.resolve(provider),
      pending: new Map(),
      closed: false,
    };
    this.#runtimes.set(id, runtime);
    provider.onNotification((method, params) => {
      if (!runtime.closed && !this.#closed)
        try {
          this.notification(id, method, params);
        } catch (error) {
          this.fail(id, error);
        }
    });
    provider.onFailure((error) => {
      if (!runtime.closed) this.fail(id, error);
    });
    runtime.ready = (async () => {
      await provider.initialize();
      const response = ThreadResponse.parse(
        await provider.request(info.threadId ? "thread/resume" : "thread/start", {
          ...(info.threadId ? { threadId: info.threadId } : {}),
          cwd: info.directory,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          ...(info.model ? { model: info.model } : {}),
        }),
      );
      if (runtime.closed || this.#closed) throw new Error("Agent connection ended");
      this.update(id, { threadId: response.thread.id, model: response.model ?? info.model });
      // Rehydrate provider history after restart using stable item and turn identities.
      for (const turn of response.thread.turns)
        for (const raw of turn.items) this.lifecycle(id, turn.id, raw, true);
      if (info.threadId) {
        const active = response.thread.turns.findLast((t) => t.status === "inProgress");
        if (active) {
          this.update(id, { status: "working", turnId: active.id, error: null });
          throw new Error(
            "The previous turn is still active; interrupt it before sending another prompt",
          );
        }
      }
      return provider;
    })();
    return runtime.ready;
  }
  async request(request: AgentRequest): Promise<AgentResult> {
    try {
      if (this.#closed) throw new Error("Daemon is shutting down");
      const op = request.operation;
      if (op.kind === "read") return this.result(request, op.sessionId, op.before);
      const receipt = this.#store.agentReceipt(request);
      if (receipt) return this.result(request, receipt);
      if (op.kind === "start") {
        const project = this.#store.snapshot().projects.find((p) => p.id === op.projectId);
        if (!project || !(await stat(project.directory)).isDirectory())
          throw new Error("Project folder is unavailable");
        const repeated = this.#store.agentReceipt(request);
        if (repeated) return this.result(request, repeated);
        if (this.#closed) throw new Error("Daemon is shutting down");
        const now = new Date().toISOString();
        const info: AgentInfo = {
          id: randomUUID(),
          projectId: project.id,
          name: "Codex",
          directory: project.directory,
          provider: "codex",
          model: op.model ?? null,
          threadId: null,
          turnId: null,
          status: "starting",
          pending: [],
          error: null,
          startedAt: now,
          updatedAt: now,
          turnStartedAt: null,
          revision: 0,
        };
        this.#store.reserveAgent(request, info);
        this.#workspaceChanged();
        this.#emit({ type: "agent.state", agent: info });
        void Promise.resolve()
          .then(() => this.provider(info.id))
          .then(() => this.update(info.id, { status: "idle" }))
          .catch((error) => this.fail(info.id, error));
        return this.result(request, info.id);
      }
      const info = this.#store.agent(op.sessionId);
      if (op.kind === "send") {
        if (["starting", "working", "needs_input"].includes(info.status))
          throw new Error("This agent already has an active turn");
        if (!info.threadId)
          throw new Error(
            "This conversation could not be started. Create a new chat pane after fixing the connection.",
          );
        const turnId = `pending:${request.requestId}`;
        const next = {
          ...info,
          name: info.name === "Codex" ? op.text.split("\n")[0]?.slice(0, 80) || "Codex" : info.name,
          status: "working" as const,
          turnId,
          turnStartedAt: new Date().toISOString(),
          pending: [],
          error: null,
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.#store.reserveAgentAction(request, next);
        this.#emit({ type: "agent.state", agent: next });
        this.item(info.id, turnId, {
          id: `prompt:${request.requestId}`,
          kind: "user",
          title: "You",
          text: op.text,
          detail: "",
          status: "completed",
        });
        void this.send(info.id, op.text).catch((error) => this.fail(info.id, error));
      } else if (op.kind === "interrupt") {
        if (info.turnId !== op.turnId || !["working", "needs_input"].includes(info.status))
          throw new Error("That turn is no longer active");
        if (op.turnId.startsWith("pending:"))
          throw new Error("The turn is still starting; interrupt once it connects");
        const runtime = this.#runtimes.get(info.id);
        if (!runtime) throw new Error("Agent connection is no longer active");
        this.#store.reserveAgentAction(request, info);
        await runtime.provider.request("turn/interrupt", {
          threadId: info.threadId,
          turnId: op.turnId,
        });
      } else {
        const pending = info.pending.find((p) => p.id === op.pendingId);
        const runtime = this.#runtimes.get(info.id);
        const resolver = runtime?.pending.get(op.pendingId);
        if (!pending || !resolver || !runtime || pending.turnId !== info.turnId)
          throw new Error("This request was already answered or is no longer active");
        let value: unknown;
        if (pending.kind === "approval") {
          if (!op.decision || !pending.decisions.includes(op.decision))
            throw new Error("Choose one of the available decisions");
          value = { decision: op.decision };
        } else {
          if (!op.answers || pending.questions.some((q) => !op.answers?.[q.id]?.length))
            throw new Error("Answer each question");
          value = {
            answers: Object.fromEntries(
              pending.questions.map((q) => [q.id, { answers: op.answers?.[q.id] ?? [] }]),
            ),
          };
        }
        const remaining = info.pending.filter((p) => p.id !== pending.id);
        const next = {
          ...info,
          pending: remaining,
          status: remaining.length ? ("needs_input" as const) : ("working" as const),
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.#store.reserveAgentAction(request, next);
        runtime.pending.delete(pending.id);
        resolver.resolve(value);
        this.#emit({ type: "agent.state", agent: next });
      }
      return this.result(request, op.sessionId);
    } catch (error) {
      return {
        type: "agent.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        },
      };
    }
  }
  private result(request: AgentRequest, id: string, before?: number): AgentResult {
    return {
      type: "agent.result",
      requestId: request.requestId,
      outcome: { status: "ok", conversation: this.#store.agentConversation(id, before) },
    };
  }
  private async send(id: string, text: string): Promise<void> {
    const provider = await this.provider(id);
    const info = this.#store.agent(id);
    const response = z.object({ turn: Turn }).parse(
      await provider.request("turn/start", {
        threadId: info.threadId,
        input: [{ type: "text", text }],
      }),
    );
    const current = this.#store.agent(id);
    if (current.turnId?.startsWith("pending:")) this.started(id, response.turn.id);
  }
  private started(id: string, turnId: string): void {
    const info = this.#store.agent(id);
    if (info.turnId === turnId) return;
    if (info.turnId?.startsWith("pending:")) {
      for (const item of this.#store.agentConversation(id).items)
        if (item.turnId === info.turnId) this.item(id, turnId, item);
    }
    this.update(id, {
      turnId,
      status: "working",
      error: null,
      turnStartedAt: info.turnId?.startsWith("pending:")
        ? info.turnStartedAt
        : new Date().toISOString(),
    });
  }
  private lifecycle(id: string, turnId: string, raw: unknown, completed: boolean): void {
    const mapped = mapCodexItem(raw, completed);
    if (!mapped) return;
    // Locally submitted prompts are reserved before dispatch; replace their turn identity, not their text.
    if (
      mapped.kind === "user" &&
      this.#store.agentConversation(id).items.some((i) => i.kind === "user" && i.turnId === turnId)
    )
      return;
    this.item(id, turnId, mapped);
  }
  private notification(id: string, method: string, raw: unknown): void {
    const params = ObjectValue.parse(raw);
    const info = this.#store.agent(id);
    if (params["threadId"] !== info.threadId) return;
    if (method === "turn/started") {
      const turn = Turn.parse(params["turn"]);
      this.started(id, turn.id);
      return;
    }
    if (method === "serverRequest/resolved") {
      const runtime = this.#runtimes.get(id);
      if (!runtime) return;
      for (const [key, value] of runtime.pending)
        if (value.providerId === params["requestId"]) {
          runtime.pending.delete(key);
          value.reject(new Error("Request was resolved by Codex"));
        }
      const pending = info.pending.filter((p) => runtime.pending.has(p.id));
      if (pending.length !== info.pending.length)
        this.update(id, { pending, status: pending.length ? "needs_input" : "working" });
      return;
    }
    if (method === "turn/completed") {
      const turn = Turn.parse(params["turn"]);
      if (turn.id !== info.turnId) return;
      const runtime = this.#runtimes.get(id);
      if (runtime) {
        for (const p of runtime.pending.values()) p.reject(new Error("Turn ended"));
        runtime.pending.clear();
      }
      if (turn.status !== "completed")
        for (const item of this.#store.agentTurnItems(id, turn.id))
          if (item.status === "running")
            this.item(id, turn.id, {
              ...item,
              status: turn.status === "interrupted" ? "interrupted" : "failed",
            });
      const duration = info.turnStartedAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(info.turnStartedAt)) / 1000))
        : 0;
      this.item(id, turn.id, {
        id: `turn:${turn.id}`,
        kind: "system",
        title:
          turn.status === "completed"
            ? "Completed"
            : turn.status === "interrupted"
              ? "Interrupted"
              : "Failed",
        text: turn.error?.message ?? `${duration}s`,
        detail: "",
        status:
          turn.status === "completed"
            ? "completed"
            : turn.status === "interrupted"
              ? "interrupted"
              : "failed",
      });
      this.update(id, {
        status:
          turn.status === "completed"
            ? "done"
            : turn.status === "interrupted"
              ? "interrupted"
              : "failed",
        pending: [],
        error: turn.error?.message ?? null,
      });
      return;
    }
    if (params["turnId"] !== info.turnId) return;
    if (method === "item/started" || method === "item/completed")
      this.lifecycle(id, String(params["turnId"]), params["item"], method === "item/completed");
    else if (
      ["item/agentMessage/delta", "item/plan/delta", "item/commandExecution/outputDelta"].includes(
        method,
      )
    ) {
      const event = z
        .object({ itemId: z.string(), delta: z.string(), turnId: z.string() })
        .parse(params);
      const prior = this.#store.agentItem(id, event.itemId);
      const tool = method === "item/commandExecution/outputDelta";
      this.item(id, event.turnId, {
        id: event.itemId,
        kind: tool ? "tool" : method === "item/plan/delta" ? "plan" : "assistant",
        title: prior?.title ?? (tool ? "Run command" : "Codex"),
        text: tool ? (prior?.text ?? "") : (prior?.text ?? "") + event.delta,
        detail: tool ? (prior?.detail ?? "") + event.delta : (prior?.detail ?? ""),
        status: "running",
      });
    } else if (method === "turn/plan/updated") {
      const plan = z
        .array(z.object({ step: z.string(), status: z.string() }))
        .parse(params["plan"]);
      this.item(id, String(info.turnId), {
        id: `plan:${info.turnId}`,
        kind: "plan",
        title: "Progress",
        text: plan
          .map(
            (p) =>
              `${p.status === "completed" ? "✓" : p.status === "inProgress" ? "→" : "○"} ${p.step}`,
          )
          .join("\n"),
        detail: "",
        status: "running",
      });
    }
  }
  private approval(
    id: string,
    method: string,
    raw: unknown,
    providerId: string | number,
  ): Promise<unknown> {
    const scope = Scope.parse(raw);
    const params = ObjectValue.parse(raw);
    const info = this.#store.agent(id);
    const runtime = this.#runtimes.get(id);
    if (
      !runtime ||
      info.threadId !== scope.threadId ||
      info.turnId !== scope.turnId ||
      !["working", "needs_input"].includes(info.status)
    )
      throw new Error("Approval is not for the active turn");
    const questions = method === "item/tool/requestUserInput" || method === "tool/requestUserInput";
    if (
      !questions &&
      !["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)
    )
      throw new Error(`Unsupported input request: ${method}`);
    const pending: AgentPending = {
      id: randomUUID(),
      turnId: scope.turnId,
      kind: questions ? "questions" : "approval",
      title: questions
        ? "Codex needs your input"
        : method.includes("fileChange")
          ? "Allow file changes?"
          : "Allow command execution?",
      summary: [
        normalizeCommandExecutionCommand(params["command"]),
        typeof params["reason"] === "string" ? params["reason"] : "",
        typeof params["grantRoot"] === "string" ? `Folder: ${params["grantRoot"]}` : "",
        params["networkApprovalContext"]
          ? `Network access: ${JSON.stringify(params["networkApprovalContext"])}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000),
      detail: JSON.stringify(params, null, 2).slice(0, 16000),
      decisions: questions ? [] : ["accept", "decline", "cancel"],
      questions: questions ? z.array(AgentQuestionSchema).max(3).parse(params["questions"]) : [],
    };
    if (Array.isArray(params["availableDecisions"]))
      pending.decisions = pending.decisions.filter((d) =>
        (params["availableDecisions"] as unknown[]).includes(d),
      );
    const result = new Promise<unknown>((resolve, reject) =>
      runtime.pending.set(pending.id, { providerId, resolve, reject }),
    );
    this.update(id, { status: "needs_input", pending: [...info.pending, pending] });
    return result;
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all(
      [...this.#runtimes.values()].map(async (runtime) => {
        runtime.closed = true;
        for (const p of runtime.pending.values()) p.reject(new Error("Daemon is shutting down"));
        await runtime.provider.close();
      }),
    );
    this.#runtimes.clear();
  }
}
