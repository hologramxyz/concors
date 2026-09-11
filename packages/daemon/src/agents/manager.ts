import { defaultSettings, parseModels, turnControls } from "./controls.ts";
import { saveAttachments } from "./attachments.ts";
import type { AgentAttachment } from "@concors/protocol";
import { normalizeCommandExecutionCommand } from "./codex/command-display.ts";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  AgentControlsSchema,
  parseAgentCommand,
  AgentQuestionSchema,
  type AgentInfo,
  type AgentItem,
  type AgentEvent,
  type AgentPending,
  type AgentRequest,
  type AgentResult,
} from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { mapCodexItem } from "./codex/items.ts";

import { createProvider, type AgentProviderFactory } from "./providers/index.ts";
import type { ConversationProvider as AgentProvider } from "./providers/contract.ts";
import { agentProviderName, type AgentProviderCatalog } from "@concors/protocol";
export type { AgentProviderFactory } from "./providers/index.ts";
export type { ConversationProvider as AgentProvider } from "./providers/contract.ts";

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
  cancelledTurn: string | null;
}

export class AgentManager {
  readonly #store: WorkspaceStore;
  readonly #emit: (event: AgentEvent) => void;
  readonly #workspaceChanged: () => void;
  readonly #factory: AgentProviderFactory;
  readonly #runtimes = new Map<string, Runtime>();
  #closed = false;
  private registry: ProviderRegistry;
  private catalogs = new Map<string, { expires: number; value: Promise<AgentProviderCatalog[]> }>();
  constructor(
    store: WorkspaceStore,
    emit: (event: AgentEvent) => void,
    workspaceChanged: () => void,
    factory: AgentProviderFactory = createProvider,
    registry: ProviderRegistry = new ProviderRegistry(),
  ) {
    this.registry = registry;
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
          attention: null,
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
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    if (next.status === "done" && (prior.status !== "done" || next.turnId !== prior.turnId))
      next.attention = { id: randomUUID(), kind: "done", createdAt: next.updatedAt, seen: false };
    else if (
      next.status === "needs_input" &&
      next.pending.some((p) => !prior.pending.some((old) => old.id === p.id))
    )
      next.attention = {
        id: randomUUID(),
        kind: "needs_input",
        createdAt: next.updatedAt,
        seen: false,
      };
    else if (!["done", "needs_input"].includes(next.status)) next.attention = null;
    this.#store.saveAgent(next);
    this.#emit({ type: "agent.state", agent: next });
    return next;
  }
  private item(
    id: string,
    turnId: string,
    value: Pick<AgentItem, "id" | "kind" | "title" | "text" | "detail" | "status" | "presentation">,
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
    const provider = this.#factory(
      info.directory,
      (method, params, requestId) => this.approval(id, method, params, requestId),
      info.provider,
    );
    const runtime: Runtime = {
      provider,
      ready: Promise.resolve(provider),
      pending: new Map(),
      closed: false,
      cancelledTurn: null,
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
      try {
        const models = parseModels(
          await provider.request("model/list", {}),
          this.registry.config(info.provider).models,
        );
        this.update(id, { models });
      } catch {
        /* Older providers can still run their configured model. */
      }
      try {
        const modes = z
          .object({ data: z.array(z.object({ mode: z.string().nullable().optional() })) })
          .parse(await provider.request("collaborationMode/list", {}));
        this.update(id, { supportsPlan: modes.data.some((mode) => mode.mode === "plan") });
      } catch {
        this.update(id, { supportsPlan: false });
      }
      try {
        this.update(id, {
          controls: AgentControlsSchema.parse(await provider.request("session/controls")),
        });
      } catch {
        // Older transports have no capability contract. They do not receive new controls.
      }
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
      const operation = request.operation;
      const op =
        operation.kind === "command"
          ? {
              kind: "send" as const,
              sessionId: operation.sessionId,
              text: `/${operation.name}${operation.args ? ` ${operation.args}` : ""}`,
              attachments: undefined,
            }
          : operation;
      if (op.kind === "read") return this.result(request, op.sessionId, op.before);
      if (op.kind === "seen") {
        const info = this.#store.agent(op.sessionId);
        if (info.attention?.id === op.attentionId && !info.attention.seen)
          this.update(info.id, {
            attention: { ...info.attention, seen: true },
            updatedAt: info.updatedAt,
          });
        return this.result(request, op.sessionId);
      }
      if (op.kind === "provider-catalog") {
        const info = this.#store.agent(op.sessionId);
        const providers = await this.catalog(info, op.provider);
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: this.#store.agentConversation(info.id),
            providers,
          },
        };
      }
      const receipt = this.#store.agentReceipt(request);
      if (receipt) return this.result(request, receipt);
      if (op.kind === "switch-provider") {
        const previous = this.#store.agent(op.sessionId);
        if (previous.revision !== op.expectedRevision) throw new Error("Agent changed. Try again.");
        if (previous.provider === op.provider) throw new Error("Choose a different provider");
        const catalog = (await this.catalog(previous, op.provider)).find(
          (p) => p.id === op.provider,
        );
        if (!catalog || catalog.error)
          throw new Error(catalog?.error ?? "Provider is not installed on this machine");
        if (op.model && !catalog.models.some((m) => m.id === op.model))
          throw new Error("That model is not available");
      }
      if (op.kind === "start" || op.kind === "switch-provider") {
        const previous =
          op.kind === "switch-provider" ? this.#store.agent(op.sessionId) : undefined;
        const project = this.#store
          .snapshot()
          .projects.find(
            (p) => p.id === (op.kind === "start" ? op.projectId : previous?.projectId),
          );
        const pane =
          op.kind === "start"
            ? project?.tabs
                .find((tab) => tab.id === op.tabId)
                ?.nodes.find((node) => node.id === op.paneId)
            : undefined;
        const directory =
          pane?.kind === "pane"
            ? (pane.directory ?? project?.directory)
            : (previous?.directory ?? project?.directory);
        if (!project || !directory || !(await stat(directory)).isDirectory())
          throw new Error("Project folder is unavailable");
        const repeated = this.#store.agentReceipt(request);
        if (repeated) return this.result(request, repeated);
        if (this.#closed) throw new Error("Daemon is shutting down");
        const now = new Date().toISOString();
        const info: AgentInfo = {
          id: randomUUID(),
          projectId: project.id,
          name: agentProviderName(op.provider ?? "codex"),
          directory,
          provider: op.provider ?? "codex",
          model: op.model ?? null,
          settings: { ...defaultSettings, model: op.model ?? null },
          context: null,
          threadId: null,
          turnId: null,
          status: "starting",
          pending: [],
          attention: null,
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
      if (op.kind === "refresh-models") {
        const provider = await this.provider(info.id);
        this.update(info.id, {
          models: parseModels(
            await provider.request("model/list", {}),
            this.registry.config(info.provider).models,
          ),
          updatedAt: info.updatedAt,
        });
        return this.result(request, info.id);
      }
      if (op.kind === "configure") {
        if (
          info.provider !== "codex" &&
          (op.settings.mode !== "default" || op.settings.planMode || op.settings.serviceTier)
        )
          throw new Error("This provider uses its native tool approvals and model defaults");
        if (info.revision !== op.expectedRevision)
          throw new Error("Agent settings changed. Try again.");
        if (
          op.settings.nativeMode &&
          !info.controls?.modes.some((m) => m.id === op.settings.nativeMode)
        )
          throw new Error("That mode is not available for this provider.");
        for (const [key, value] of Object.entries(op.settings.features ?? {})) {
          const feature = info.controls?.features.find((f) => f.id === key);
          if (
            !feature ||
            (feature.options
              ? !feature.options.some((o) => o.id === value)
              : typeof value !== "boolean")
          )
            throw new Error("That feature is not available for this provider.");
        }
        if (
          op.settings.model &&
          info.models?.length &&
          !info.models.some((m) => m.id === op.settings.model)
        )
          throw new Error("That model is not available on this machine.");
        if (op.settings.planMode && !info.supportsPlan)
          throw new Error(
            "Plan mode is not available on this machine. Update Codex and open a new agent session.",
          );
        const model = info.models?.find((m) => m.id === (op.settings.model ?? info.model));
        if (op.settings.effort && model && !model.efforts.includes(op.settings.effort))
          throw new Error("That thinking effort is not supported by this model.");
        if (
          op.settings.serviceTier &&
          !model?.serviceTiers?.some((tier) => tier.id === op.settings.serviceTier)
        )
          throw new Error("That speed is not supported by this model.");
        this.#store.reserveAgentAction(request, {
          ...info,
          settings: op.settings,
          revision: info.revision + 1,
        });
        this.#emit({ type: "agent.state", agent: this.#store.agent(info.id) });
        return this.result(request, info.id);
      }
      if (op.kind === "send") {
        if (["starting", "working", "needs_input"].includes(info.status))
          throw new Error("This agent already has an active turn");
        if (!info.threadId)
          throw new Error(
            "This conversation could not be started. Create a new chat pane after fixing the connection.",
          );
        const command = parseAgentCommand(op.text);
        if (command) {
          if (!info.controls?.commands.some((c) => c.name === command.name))
            throw new Error(
              `/${command.name} is not available for this agent. Check its commands or update its CLI.`,
            );
          if (op.attachments?.length)
            throw new Error("Send attachments in a message, separately from a command.");
        }
        const turnId = `pending:${request.requestId}`;
        const next = {
          ...info,
          name:
            info.name === agentProviderName(info.provider)
              ? op.text.split("\n")[0]?.slice(0, 80) || agentProviderName(info.provider)
              : info.name,
          status: "working" as const,
          turnId,
          turnStartedAt: new Date().toISOString(),
          pending: [],
          attention: null,
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
          text:
            op.text +
            (op.attachments?.length
              ? "\n\nAttached: " + op.attachments.map((a) => a.name).join(", ")
              : ""),
          detail: "",
          status: "completed",
        });
        void this.send(info.id, op.text, op.attachments ?? [], next.settings).catch((error) =>
          this.fail(info.id, error),
        );
      } else if (op.kind === "interrupt") {
        if (info.turnId !== op.turnId || !["working", "needs_input"].includes(info.status))
          throw new Error("That turn is no longer active");
        if (op.turnId.startsWith("pending:"))
          throw new Error("The turn is still starting; interrupt once it connects");
        const runtime = this.#runtimes.get(info.id);
        if (!runtime) throw new Error("Agent connection is no longer active");
        this.#store.reserveAgentAction(request, info);
        await this.interrupt(info.id, runtime, op.turnId);
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
          attention: remaining.length ? info.attention : null,
          status: remaining.length ? ("needs_input" as const) : ("working" as const),
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.#store.reserveAgentAction(request, next);
        const cancel = pending.kind === "approval" && op.decision === "cancel";
        if (cancel) runtime.cancelledTurn = pending.turnId;
        runtime.pending.delete(pending.id);
        resolver.resolve(value);
        this.#emit({ type: "agent.state", agent: next });
        if (cancel) await this.interrupt(info.id, runtime, pending.turnId);
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
  private async interrupt(id: string, runtime: Runtime, turnId: string): Promise<void> {
    runtime.cancelledTurn = turnId;
    try {
      await runtime.provider.request("turn/interrupt", {
        threadId: this.#store.agent(id).threadId,
        turnId,
      });
    } catch (error) {
      // A provider can finish while its cancel request is in flight. A terminal
      // state is authoritative; otherwise preserve the error and allow retry.
      if (this.#store.agent(id).status !== "interrupted") {
        runtime.cancelledTurn = null;
        throw error;
      }
    }
  }
  private async send(
    id: string,
    text: string,
    attachments: AgentAttachment[],
    settings: AgentInfo["settings"],
  ): Promise<void> {
    const provider = await this.provider(id);
    const info = this.#store.agent(id);
    const uploaded = attachments.length
      ? await saveAttachments(this.#store.attachmentsDirectory, id, attachments)
      : [];
    const command = parseAgentCommand(text);
    const response = z.object({ turn: Turn }).parse(
      await provider.request(command ? "command/execute" : "turn/start", {
        threadId: info.threadId,
        input: [...(text ? [{ type: "text", text }] : []), ...uploaded],
        ...(command ?? {}),
        ...turnControls({ ...info, settings: settings ?? defaultSettings }),
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
    this.item(id, turnId, {
      ...mapped,
      ...(mapped.kind === "assistant"
        ? { title: agentProviderName(this.#store.agent(id).provider) }
        : {}),
    });
  }
  private notification(id: string, method: string, raw: unknown): void {
    const params = ObjectValue.parse(raw);
    const info = this.#store.agent(id);
    if (params["threadId"] !== info.threadId) {
      for (const item of this.#store.agentConversation(id).items) {
        const children = item.presentation?.children;
        if (!children?.some((child) => child.id === params["threadId"])) continue;
        let status: string | undefined, message: string | undefined;
        if (method === "turn/started") status = "running";
        if (method === "turn/completed") {
          const turn = Turn.safeParse(params["turn"]);
          if (turn.success) status = turn.data.status;
        }
        if (method === "item/completed") {
          const output = z
            .object({ type: z.literal("agentMessage"), text: z.string() })
            .safeParse(params["item"]);
          if (output.success) message = output.data.text.slice(0, 4000);
        }
        if (status || message)
          this.item(id, item.turnId, {
            ...item,
            presentation: {
              ...item.presentation,
              type: "sub_agent",
              children: children.map((child) =>
                child.id === params["threadId"]
                  ? { ...child, status: status ?? child.status, message: message ?? child.message }
                  : child,
              ),
            },
          });
      }
      return;
    }
    if (method === "session/controls/updated") {
      this.update(id, { controls: AgentControlsSchema.parse(params["controls"]) });
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = z
        .object({
          last: z.object({ totalTokens: z.number().nonnegative() }),
          total: z.object({ totalTokens: z.number().nonnegative().nullable() }),
          modelContextWindow: z.number().positive().nullable(),
        })
        .safeParse(params["tokenUsage"]);
      if (usage.success)
        this.update(id, {
          context: {
            used: usage.data.last.totalTokens,
            total: usage.data.total.totalTokens,
            limit: usage.data.modelContextWindow,
          },
          updatedAt: info.updatedAt,
        });
      return;
    }
    if (method === "turn/started") {
      const turn = Turn.parse(params["turn"]);
      if (this.#runtimes.get(id)?.cancelledTurn === turn.id) return;
      this.started(id, turn.id);
      return;
    }
    if (method === "serverRequest/resolved") {
      const runtime = this.#runtimes.get(id);
      if (!runtime) return;
      for (const [key, value] of runtime.pending)
        if (value.providerId === params["requestId"]) {
          runtime.pending.delete(key);
          value.reject(new Error("Request was resolved by the provider"));
        }
      const pending = info.pending.filter((p) => runtime.pending.has(p.id));
      if (pending.length !== info.pending.length)
        this.update(id, { pending, status: pending.length ? "needs_input" : "working" });
      return;
    }
    if (method === "turn/completed") {
      const turn = Turn.parse(params["turn"]);
      if (turn.id !== info.turnId || !["starting", "working", "needs_input"].includes(info.status))
        return;
      const runtime = this.#runtimes.get(id);
      if (runtime?.cancelledTurn === turn.id) {
        turn.status = "interrupted";
        turn.error = null;
      }
      if (runtime) {
        for (const p of runtime.pending.values()) p.reject(new Error("Turn ended"));
        runtime.pending.clear();
      }
      for (const item of this.#store.agentTurnItems(id, turn.id)) {
        const status =
          turn.status === "completed"
            ? "completed"
            : turn.status === "interrupted"
              ? "interrupted"
              : "failed";
        const children = item.presentation?.children?.map((child) =>
          status !== "completed" && ["running", "pending", "inProgress"].includes(child.status)
            ? { ...child, status }
            : child,
        );
        if (item.status === "running" || children)
          this.item(id, turn.id, {
            ...item,
            status: item.status === "running" ? status : item.status,
            ...(children && item.presentation
              ? { presentation: { ...item.presentation, children } }
              : {}),
          });
      }
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
    if (this.#runtimes.get(id)?.cancelledTurn === params["turnId"]) return;
    if (method === "item/started" || method === "item/completed")
      this.lifecycle(id, String(params["turnId"]), params["item"], method === "item/completed");
    else if (
      [
        "item/agentMessage/delta",
        "item/plan/delta",
        "item/commandExecution/outputDelta",
        "item/reasoning/summaryTextDelta",
      ].includes(method)
    ) {
      const event = z
        .object({ itemId: z.string(), delta: z.string(), turnId: z.string() })
        .parse(params);
      const prior = this.#store.agentItem(id, event.itemId);
      const tool = method === "item/commandExecution/outputDelta";
      this.item(id, event.turnId, {
        id: event.itemId,
        kind:
          tool || method === "item/reasoning/summaryTextDelta"
            ? "tool"
            : method === "item/plan/delta"
              ? "plan"
              : "assistant",
        presentation:
          method === "item/reasoning/summaryTextDelta" ? { type: "thinking" } : prior?.presentation,
        title:
          prior?.title ??
          (tool
            ? "Run command"
            : method === "item/reasoning/summaryTextDelta"
              ? "Thinking"
              : agentProviderName(info.provider)),
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
        presentation: { type: "plan", steps: plan.slice(0, 100) },
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
        ? `${agentProviderName(info.provider)} needs your input`
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
      questions: questions ? z.array(AgentQuestionSchema).max(32).parse(params["questions"]) : [],
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
  private async catalog(info: AgentInfo, selected?: string): Promise<AgentProviderCatalog[]> {
    const configs = this.registry.configs().filter((c) => c.enabled && this.registry.installed(c));
    return Promise.all(
      configs.map(async (config): Promise<AgentProviderCatalog> => {
        const id = config.id,
          label = config.label;
        if (id === info.provider && info.models?.length)
          return { id, label, models: info.models, loaded: true };
        if (id !== selected) return { id, label, models: [], loaded: false };
        const key = `${info.directory}:${id}:${this.registry.revision}`;
        const cached = this.catalogs.get(key);
        if (cached && cached.expires > Date.now())
          return (await cached.value)[0] ?? { id, label, models: [], loaded: false };
        const value = (async (): Promise<AgentProviderCatalog[]> => {
          let provider: AgentProvider | undefined, timer: ReturnType<typeof setTimeout> | undefined;
          try {
            provider = this.#factory(
              info.directory,
              async () => {
                throw new Error("Model discovery cannot approve tools or send prompts");
              },
              id,
            );
            const current = provider;
            const models = await Promise.race([
              (async () => {
                await current.initialize();
                await current.request("thread/start", {
                  cwd: info.directory,
                  approvalPolicy: "on-request",
                  sandbox: "workspace-write",
                });
                return parseModels(await current.request("model/list", {}), config.models);
              })(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(new Error("Model discovery timed out. Check the provider in Settings.")),
                  90000,
                );
              }),
            ]);
            return [{ id, label, models, loaded: true }];
          } catch (error) {
            return [
              {
                id,
                label,
                models: [],
                loaded: true,
                error: error instanceof Error ? error.message : "Could not load provider models",
              },
            ];
          } finally {
            clearTimeout(timer);
            await provider?.close();
          }
        })();
        if (this.catalogs.size >= 128)
          this.catalogs.delete(this.catalogs.keys().next().value ?? "");
        this.catalogs.set(key, { expires: Date.now() + 60000, value });
        return (await value)[0] ?? { id, label, models: [], loaded: false };
      }),
    );
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
