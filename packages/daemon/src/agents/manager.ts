import { questionAnswers } from "./questions.ts";
import { approvalActions } from "./approval-actions.ts";
import {
  AgentAccounts,
  accountBackendFactory,
  type AccountBackendFactory,
} from "./accounts/manager.ts";
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
import { elicitationQuestions, elicitationContent } from "./elicitation.ts";
import { mapCodexItem } from "./codex/items.ts";

import { createProvider, type AgentProviderFactory } from "./providers/index.ts";
import type { ConversationProvider as AgentProvider } from "./providers/contract.ts";
import {
  agentProviderName,
  NativeSessionSchema,
  type AgentProviderCatalog,
} from "@concors/protocol";
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
  nativeDecisions?: Map<string, unknown>;
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
  private mutations = new Set<string>();
  private draining = new Set<string>();
  private deliveries = new Map<string, string>();
  private registry: ProviderRegistry;
  readonly accounts: AgentAccounts;
  private catalogs = new Map<string, { expires: number; value: Promise<AgentProviderCatalog[]> }>();
  constructor(
    store: WorkspaceStore,
    emit: (event: AgentEvent) => void,
    workspaceChanged: () => void,
    factory: AgentProviderFactory = createProvider,
    registry: ProviderRegistry = new ProviderRegistry(),
    accountFactory?: AccountBackendFactory,
  ) {
    this.registry = registry;
    this.#store = store;
    this.#emit = emit;
    this.#workspaceChanged = workspaceChanged;
    this.#factory = factory;
    this.accounts = new AgentAccounts(accountFactory ?? accountBackendFactory(registry), (info) => {
      this.catalogs.clear();
      // Idle runtimes reload the provider's freshly saved credentials on the next send.
      for (const [id, runtime] of this.#runtimes) {
        const current = this.#store.agent(id);
        if (
          current.directory !== info.directory ||
          current.provider !== info.provider ||
          ["starting", "working", "needs_input"].includes(current.status)
        )
          continue;
        runtime.closed = true;
        this.#runtimes.delete(id);
        void runtime.provider.close().catch(() => undefined);
      }
    });
    for (const info of store.agents())
      if (["starting", "working", "needs_input"].includes(info.status)) {
        store.saveAgent({
          ...info,
          status: "interrupted",
          queuePaused: true,
          pending: info.pending.filter((p) => p.asynchronous),
          attention: info.pending.some((p) => p.asynchronous) ? info.attention : null,
          turnId: null,
          error:
            "The daemon restarted. Your saved conversation can be continued; the previous prompt will not be resent.",
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        });
      }
    queueMicrotask(() => {
      if (!this.#closed)
        for (const info of store.agents())
          void this.drain(info.id).catch((error) => this.fail(info.id, error));
    });
  }
  private async drain(id: string): Promise<void> {
    if (this.#closed || this.draining.has(id) || this.mutations.has(id)) return;
    const info = this.#store.agent(id),
      head = info.queue?.[0];
    if (!head || info.queuePaused || !["idle", "done"].includes(info.status)) return;
    const request = this.#store.queuedRequest(head.id, id);
    if (!request) {
      this.update(id, {
        queuePaused: true,
        error: "Queued message is unavailable. Remove it and try again.",
      });
      return;
    }
    this.draining.add(id);
    this.deliveries.set(request.requestId, head.id);
    try {
      const result = await this.request(request);
      if (result.outcome.status === "error")
        this.update(id, { queuePaused: true, error: result.outcome.message });
    } finally {
      this.deliveries.delete(request.requestId);
      this.draining.delete(id);
      queueMicrotask(() => {
        void this.drain(id).catch((error) => this.fail(id, error));
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
    if (next.pending.some((p) => !prior.pending.some((old) => old.id === p.id)))
      next.attention = {
        id: randomUUID(),
        kind: "needs_input",
        createdAt: next.updatedAt,
        seen: false,
      };
    else if (next.pending.length && prior.attention?.kind === "needs_input")
      next.attention = patch.attention === undefined ? prior.attention : patch.attention;
    else if (next.status === "done" && (prior.status !== "done" || next.turnId !== prior.turnId))
      next.attention = { id: randomUUID(), kind: "done", createdAt: next.updatedAt, seen: false };
    else if (!["done", "needs_input"].includes(next.status)) next.attention = null;
    this.#store.saveAgent(next);
    this.#emit({ type: "agent.state", agent: next });
    if (["idle", "done"].includes(next.status) && next.queue?.length && !next.queuePaused)
      queueMicrotask(() => {
        void this.drain(id).catch((error) => this.fail(id, error));
      });
    return next;
  }
  private item(
    id: string,
    turnId: string,
    value: Pick<
      AgentItem,
      "id" | "kind" | "title" | "text" | "detail" | "status" | "presentation" | "attachments"
    >,
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
      void runtime.provider.close().catch(() => undefined);
    }
    this.update(id, {
      status: "failed",
      queuePaused: true,
      pending: this.#store.agent(id).pending.filter((p) => p.asynchronous),
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
      const options = {
        cwd: info.directory,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        ...(info.model ? { model: info.model } : {}),
      };
      let response: z.infer<typeof ThreadResponse>;
      try {
        response = ThreadResponse.parse(
          await provider.request(info.threadId ? "thread/resume" : "thread/start", {
            ...options,
            ...(info.threadId ? { threadId: info.threadId } : {}),
          }),
        );
      } catch (error) {
        // Codex can discard a thread closed before its first turn (including on sign-in).
        // Only replace that empty thread; never discard history or replay reserved prompts.
        if (
          this.registry.config(info.provider).engine !== "codex" ||
          !info.threadId ||
          !(error instanceof Error) ||
          error.message !== `no rollout found for thread id ${info.threadId}` ||
          this.#store.hasAgentProviderHistory(id) ||
          runtime.closed ||
          this.#closed
        )
          throw error;
        response = ThreadResponse.parse(await provider.request("thread/start", options));
      }
      if (runtime.closed || this.#closed) throw new Error("Agent connection ended");
      this.update(id, {
        threadId: response.thread.id,
        model: response.model ?? info.model,
        engine: this.registry.config(info.provider).engine,
        providerLabel: this.registry.config(info.provider).label,
      });
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
        for (const raw of turn.items)
          this.lifecycle(id, this.#store.nativeTurn(id, turn.id), raw, true);
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
  async request(request: AgentRequest, owner = "local"): Promise<AgentResult> {
    let mutation: string | undefined;
    try {
      if (this.#closed) throw new Error("Daemon is shutting down");
      const original = request.operation;
      let implementation = false;
      let operation: Exclude<AgentRequest["operation"], { kind: "implement-plan" }>;
      if (original.kind === "implement-plan") {
        const receipt = this.#store.agentReceipt(request);
        if (receipt) {
          const error = this.#store.agentActionError(request.requestId);
          if (error) throw new Error(error);
          return this.result(request, receipt);
        }
        const info = this.#store.agent(original.sessionId),
          plan = this.#store.agentItem(info.id, original.itemId);
        if (
          info.revision !== original.expectedRevision ||
          !info.supportsPlan ||
          (info.engine ?? info.provider) !== "codex" ||
          !info.settings?.planMode ||
          plan?.kind !== "plan" ||
          plan.status !== "completed" ||
          plan.turnId !== info.turnId ||
          !plan.text.trim() ||
          Boolean(plan.presentation?.steps?.length)
        )
          throw new Error("This plan is no longer available to implement");
        const text =
          plan.text || plan.presentation?.steps?.map((step) => `- ${step.step}`).join("\n") || "";
        if (!text.trim()) throw new Error("The plan is empty");
        implementation = true;
        operation = {
          kind: "send",
          sessionId: info.id,
          text: `Implement this plan:\n\n${text}`.slice(0, 16000),
        };
      } else operation = original;
      const op =
        operation.kind === "command"
          ? {
              kind: "send" as const,
              sessionId: operation.sessionId,
              text: `/${operation.name}${operation.args ? ` ${operation.args}` : ""}`,
              attachments: undefined,
            }
          : operation;
      if (op.kind === "read-attachment") {
        const info = this.#store.agent(op.sessionId);
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: this.#store.agentConversation(info.id),
            attachment: this.#store.agentAttachment(info.id, op.itemId, op.index),
          },
        };
      }
      if (op.kind === "account") {
        const info = this.#store.agent(op.sessionId);
        const account = await this.accounts.request(owner, info, op.action);
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: { status: "ok", conversation: this.#store.agentConversation(info.id), account },
        };
      }
      if (op.kind === "list-messages") {
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: { agent: this.#store.agent(op.sessionId), items: [], hasMore: false },
            messageIndex: this.#store.agentMessageIndex(op.sessionId, op.before),
          },
        };
      }
      if (op.kind === "read") {
        const info = this.#store.agent(op.sessionId);
        if (
          info.threadId &&
          !this.#runtimes.has(info.id) &&
          op.before === undefined &&
          op.after === undefined
        ) {
          try {
            await this.provider(info.id);
          } catch (error) {
            // Keep saved history visible and allow a failed startup to retry.
            // A resumed native turn may still be working; keep its interrupt connection alive.
            const runtime = this.#runtimes.get(info.id);
            if (runtime && this.#store.agent(info.id).status === "working")
              runtime.ready = Promise.resolve(runtime.provider);
            else this.fail(info.id, error);
          }
        }
        return this.result(request, op.sessionId, op.before, op.after);
      }
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
      if (op.kind === "child-history") {
        const info = this.#store.agent(op.sessionId),
          parent = this.#store.agentItem(info.id, op.itemId);
        if (
          !info.controls?.childHistory ||
          !parent?.presentation?.children?.some((c) => c.id === op.childId)
        )
          throw new Error("This child conversation is not available from this session.");
        const provider = await this.provider(info.id),
          response = ThreadResponse.parse(
            await provider.request("session/child-history", { childId: op.childId }),
          );
        const childItems: AgentItem[] = [];
        for (const turn of response.thread.turns)
          for (const raw of turn.items) {
            const mapped = mapCodexItem(raw, turn.status !== "inProgress");
            if (mapped)
              childItems.push({
                ...mapped,
                sessionId: info.id,
                turnId: turn.id,
                position: childItems.length + 1,
                revision: 0,
                createdAt: new Date().toISOString(),
              });
          }
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: this.#store.agentConversation(info.id),
            childItems: childItems.slice(-80),
          },
        };
      }
      if (op.kind === "mcp-status") {
        const info = this.#store.agent(op.sessionId),
          provider = await this.provider(info.id);
        if (!this.#store.agent(info.id).controls?.mcpStatus)
          throw new Error("This agent does not expose MCP server status.");
        const response = z
          .object({ servers: z.array(z.object({ name: z.string(), status: z.string() })).max(100) })
          .parse(await provider.request("mcp/status"));
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: this.#store.agentConversation(info.id),
            servers: response.servers,
          },
        };
      }
      if (op.kind === "sessions-list") {
        const info = this.#store.agent(op.sessionId),
          provider = await this.provider(info.id);
        if (!this.#store.agent(info.id).controls?.importSessions)
          throw new Error("This agent cannot list native sessions.");
        const response = z
          .object({ sessions: z.array(NativeSessionSchema).max(100) })
          .parse(await provider.request("session/list", { cwd: info.directory }));
        return {
          type: "agent.result",
          requestId: request.requestId,
          outcome: {
            status: "ok",
            conversation: this.#store.agentConversation(info.id),
            sessions: response.sessions.filter((s) => s.directory === info.directory),
          },
        };
      }
      const receipt = this.#store.agentReceipt(request);
      if (receipt) {
        const error = this.#store.agentActionError(request.requestId);
        if (error) throw new Error(error);
        return this.result(request, receipt);
      }
      if (op.kind === "switch-provider") {
        const previous = this.#store.agent(op.sessionId);
        if (previous.revision !== op.expectedRevision) throw new Error("Agent changed. Try again.");
        if (previous.provider === op.provider) throw new Error("Choose a different provider");
        const catalog = (await this.catalog(previous, op.provider)).find(
          (p) => p.id === op.provider,
        );
        if (!catalog) throw new Error("Provider is not installed on this machine");
        if (op.model && !catalog.models.some((m) => m.id === op.model))
          throw new Error("That model is not available");
      }
      if (op.kind === "import-session" || op.kind === "fork-session") {
        const previous = this.#store.agent(op.sessionId);
        if (this.mutations.has(previous.id))
          throw new Error("This session is being changed. Try again when it finishes.");
        if (previous.revision !== op.expectedRevision) throw new Error("Agent changed. Try again.");
        if (
          op.kind === "fork-session" &&
          (!previous.controls?.fork ||
            ["starting", "working", "needs_input"].includes(previous.status))
        )
          throw new Error("Wait for this agent to finish before forking its session.");
        if (op.kind === "import-session" && !previous.controls?.importSessions)
          throw new Error("Native session import is not available for this agent.");
        if (
          op.kind === "import-session" &&
          this.#store
            .agents()
            .some((a) => a.provider === previous.provider && a.threadId === op.nativeSessionId)
        )
          throw new Error("That session is already open in Concors.");
        const now = new Date().toISOString();
        const next: AgentInfo = {
          ...previous,
          id: randomUUID(),
          name:
            op.kind === "fork-session"
              ? `${previous.name.slice(0, 70)} (fork)`
              : "Imported session",
          threadId: op.kind === "import-session" ? op.nativeSessionId : null,
          turnId: null,
          status: "starting",
          queue: [],
          queuePaused: false,
          pending: [],
          attention: null,
          error: null,
          revision: 0,
          startedAt: now,
          updatedAt: now,
          turnStartedAt: null,
          historyRevision: 0,
        };
        this.#store.reserveAgent(request, next);
        this.#workspaceChanged();
        this.#emit({ type: "agent.state", agent: next });
        if (op.kind === "fork-session") this.mutations.add(previous.id);
        void (async () => {
          if (op.kind === "fork-session") {
            const provider = await this.provider(previous.id);
            const response = ThreadResponse.parse(
              await provider.request("session/fork", {
                threadId: previous.threadId,
                cwd: previous.directory,
              }),
            );
            this.update(next.id, { threadId: response.thread.id });
          }
          await this.provider(next.id);
          this.update(next.id, { status: "idle" });
        })()
          .catch((error) => this.fail(next.id, error))
          .finally(() => {
            if (op.kind === "fork-session") {
              this.mutations.delete(previous.id);
              void this.drain(previous.id).catch((error) => this.fail(previous.id, error));
            }
          });
        return this.result(request, next.id);
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
          name: this.registry.config(op.provider ?? "codex").label,
          engine: this.registry.config(op.provider ?? "codex").engine,
          providerLabel: this.registry.config(op.provider ?? "codex").label,
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
      if (this.mutations.has(info.id))
        throw new Error("This session is being changed. Try again when it finishes.");
      if (op.kind === "steer") {
        if (
          !info.controls?.steer ||
          info.turnId !== op.turnId ||
          info.status !== "working" ||
          op.text.startsWith("/")
        )
          throw new Error(
            "Steering is only available during an active turn and does not run slash commands.",
          );
        this.#store.reserveAgentAction(request, info);
        const runtime = this.#runtimes.get(info.id);
        if (!runtime) throw new Error("Agent disconnected. The steering message was not replayed.");
        await runtime.provider.request("session/steer", {
          threadId: info.threadId,
          turnId: op.turnId,
          text: op.text,
        });
        this.item(info.id, op.turnId, {
          id: `steer:${request.requestId}`,
          kind: "user",
          title: "You · steering",
          text: op.text,
          detail: "",
          status: "completed",
        });
        return this.result(request, info.id);
      }
      if (op.kind === "rewind") {
        if (
          info.revision !== op.expectedRevision ||
          ["starting", "working", "needs_input"].includes(info.status)
        )
          throw new Error("Wait for the agent to finish before rewinding.");
        if (!info.controls?.rewind.includes(op.mode))
          throw new Error("This rewind mode is not supported by the agent.");
        const prompts = this.#store.agentPrompts(info.id).filter((i) => !i.id.startsWith("steer:")),
          index = prompts.findIndex((i) => i.turnId === op.turnId);
        if (index < 0) throw new Error("That turn is no longer available.");
        mutation = info.id;
        this.mutations.add(info.id);
        const provider = await this.provider(info.id);
        this.#store.reserveAgentAction(request, {
          ...this.#store.agent(info.id),
          queuePaused: true,
        });
        await provider.request("session/rewind", {
          threadId: info.threadId,
          nativeTurnId: this.#store.nativeTurnId(info.id, op.turnId),
          numTurns: prompts.length - index,
          mode: op.mode,
        });
        if (op.mode !== "files") this.#store.removeAgentTurnsFrom(info.id, op.turnId);
        this.update(info.id, {
          status: "idle",
          turnId: null,
          pending: [],
          attention: null,
          error: null,
          queuePaused: true,
          context: null,
          historyRevision: (info.historyRevision ?? 0) + 1,
        });
        if (op.mode === "files")
          this.item(info.id, op.turnId, {
            id: `rewind:${request.requestId}`,
            kind: "system",
            title: "Files restored",
            text: "Restored the file checkpoint. Conversation history is unchanged.",
            detail: "",
            status: "completed",
          });
        return this.result(request, info.id);
      }
      if (op.kind === "queue-add" || op.kind === "queue-remove" || op.kind === "queue-pause") {
        let queue = info.queue ?? [],
          paused = info.queuePaused ?? false;
        let delivery: AgentRequest | undefined;
        if (op.kind === "queue-add") {
          if (queue.length >= 20) throw new Error("Queue up to 20 follow-ups per agent.");
          queue = [
            ...queue,
            {
              id: request.requestId,
              text: op.text,
              attachments: (op.attachments ?? []).map((a) => ({ name: a.name, mime: a.mime })),
              queuedAt: new Date().toISOString(),
            },
          ];
          delivery = {
            type: "agent.request",
            requestId: randomUUID(),
            operation: {
              kind: "send",
              sessionId: info.id,
              text: op.text,
              attachments: op.attachments,
            },
          };
        } else if (op.kind === "queue-remove") {
          queue = queue.filter((entry) => entry.id !== op.id);
        } else paused = op.paused;
        const resume =
          op.kind === "queue-pause" && !paused && ["failed", "interrupted"].includes(info.status);
        const next = {
          ...info,
          queue,
          queuePaused: paused,
          ...(resume ? { status: "idle" as const, error: null } : {}),
          revision: info.revision + 1,
        };
        this.#store.reserveAgentAction(request, next, {
          ...(delivery ? { add: delivery } : {}),
          ...(op.kind === "queue-remove" ? { remove: op.id } : {}),
        });
        this.#emit({ type: "agent.state", agent: next });
        queueMicrotask(() => {
          void this.drain(info.id).catch((error) => this.fail(info.id, error));
        });
        return this.result(request, info.id);
      }
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
          (info.engine ?? info.provider) !== "codex" &&
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
          ...(implementation
            ? { settings: { ...(info.settings ?? defaultSettings), planMode: false } }
            : {}),
          name:
            info.name === (info.providerLabel ?? agentProviderName(info.provider))
              ? op.text.split("\n")[0]?.slice(0, 80) || agentProviderName(info.provider)
              : info.name,
          status: "working" as const,
          turnId,
          turnStartedAt: new Date().toISOString(),
          pending: info.pending.filter((p) => p.asynchronous),
          attention: null,
          error: null,
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        const queueId = this.deliveries.get(request.requestId);
        if (queueId) next.queue = (info.queue ?? []).filter((entry) => entry.id !== queueId);
        this.#store.reserveAgentAction(request, next, queueId ? { remove: queueId } : undefined);
        this.#emit({ type: "agent.state", agent: next });
        this.item(info.id, turnId, {
          id: `prompt:${request.requestId}`,
          kind: "user",
          title: "You",
          ...(op.attachments?.length
            ? { attachments: op.attachments.map(({ name, mime }) => ({ name, mime })) }
            : {}),
          text: op.text,
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
        if (pending?.asynchronous) return this.respondAsyncQuestion(request, info, pending, op);
        const runtime = this.#runtimes.get(info.id);
        const resolver = runtime?.pending.get(op.pendingId);
        if (!pending || !resolver || !runtime || pending.turnId !== info.turnId)
          throw new Error("This request was already answered or is no longer active");
        const selectedAction = op.actionId
          ? pending.actions?.find((action) => action.id === op.actionId)
          : undefined;
        if (op.actionId && !selectedAction)
          throw new Error("That permission action is no longer available");
        if (selectedAction && op.decision && op.decision !== selectedAction.decision)
          throw new Error("Permission action does not match the decision");
        const decision = selectedAction?.decision ?? op.decision;
        let value: unknown;
        if (pending.kind === "elicitation") {
          if (!decision || decision === "accept") questionAnswers(pending.questions, op.answers);
          value = {
            action:
              decision === "decline" ? "decline" : decision === "cancel" ? "cancel" : "accept",
            ...(["decline", "cancel"].includes(decision ?? "")
              ? {}
              : { content: elicitationContent(pending.elicitation?.schema, op.answers ?? {}) }),
          };
        } else if (pending.kind === "approval") {
          if (!decision || !pending.decisions.includes(decision))
            throw new Error("Choose one of the available decisions");
          if (
            !selectedAction &&
            pending.actions &&
            !pending.actions.some((action) => action.id === decision)
          )
            throw new Error("Choose an explicit permission action");
          const actionId = selectedAction?.id ?? decision;
          value = { decision: resolver.nativeDecisions?.get(actionId) ?? decision, actionId };
        } else {
          if (decision) {
            if (!pending.decisions.includes(decision) || !["decline", "cancel"].includes(decision))
              throw new Error("Choose an available question action");
            value = { decision, answers: {} };
          } else {
            value = { answers: questionAnswers(pending.questions, op.answers) };
          }
        }
        const remaining = info.pending.filter((p) => p.id !== pending.id);
        const next = {
          ...info,
          pending: remaining,
          attention: remaining.length ? info.attention : null,
          status: remaining.some((p) => !p.asynchronous)
            ? ("needs_input" as const)
            : ("working" as const),
          revision: info.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.#store.reserveAgentAction(request, next);
        const cancel = decision === "cancel";
        if (cancel) runtime.cancelledTurn = pending.turnId;
        runtime.pending.delete(pending.id);
        resolver.resolve(value);
        this.item(info.id, pending.turnId, {
          id: `response:${pending.id}`,
          kind: "system",
          title:
            pending.approvalKind === "plan"
              ? "Plan review"
              : pending.kind === "approval"
                ? "Permission"
                : "Questions",
          text:
            selectedAction?.label ??
            (decision === "cancel"
              ? "Turn canceled"
              : decision === "decline"
                ? "Dismissed"
                : decision === "accept"
                  ? "Approved"
                  : pending.questions
                      .map(
                        (q) =>
                          `${q.question}: ${q.isSecret ? "[private answer]" : (op.answers?.[q.id] ?? []).join(", ") || "Skipped"}`,
                      )
                      .join("\n")),
          detail: "",
          status: "completed",
        });
        this.#emit({ type: "agent.state", agent: next });
        if (cancel) await this.interrupt(info.id, runtime, pending.turnId);
      }
      return this.result(request, op.sessionId);
    } catch (error) {
      try {
        if (this.#store.agentReceipt(request))
          this.#store.saveAgentActionError(
            request.requestId,
            error instanceof Error ? error.message : String(error),
          );
      } catch {
        /* A conflicting request ID never changes the original receipt. */
      }
      return {
        type: "agent.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        },
      };
    } finally {
      if (mutation) {
        this.mutations.delete(mutation);
        void this.drain(mutation).catch((error) => this.fail(mutation as string, error));
      }
    }
  }
  private respondAsyncQuestion(
    request: AgentRequest,
    info: AgentInfo,
    pending: AgentPending,
    op: Extract<AgentRequest["operation"], { kind: "respond" }>,
  ): AgentResult {
    if (op.decision && op.decision !== "decline")
      throw new Error("Answer or dismiss this question");
    const answers = op.decision ? undefined : questionAnswers(pending.questions, op.answers);
    const prompt = answers
      ? "Answers to your questions:\n\n" +
        pending.questions
          .map((q) => `${q.question}\n${answers[q.id]?.answers.join(", ") ?? ""}`)
          .join("\n\n")
      : undefined;
    if (prompt && prompt.length > 16000) throw new Error("Shorten the answers before submitting");
    if (prompt && (info.queue?.length ?? 0) >= 20)
      throw new Error("Remove a queued follow-up before answering");
    const next: AgentInfo = {
      ...info,
      pending: info.pending.filter((p) => p.id !== pending.id),
      attention: info.pending.length > 1 ? info.attention : null,
      updatedAt: new Date().toISOString(),
      revision: info.revision + 1,
      ...(prompt
        ? {
            queue: [
              ...(info.queue ?? []),
              {
                id: request.requestId,
                text: prompt,
                attachments: [],
                queuedAt: new Date().toISOString(),
              },
            ],
          }
        : {}),
    };
    const delivery: AgentRequest | undefined = prompt
      ? {
          type: "agent.request",
          requestId: randomUUID(),
          operation: { kind: "send", sessionId: info.id, text: prompt },
        }
      : undefined;
    const resolution: AgentItem = {
      id: `async-response:${pending.sourceItemId}`,
      sessionId: info.id,
      turnId: pending.turnId,
      position: 0,
      revision: 0,
      createdAt: new Date().toISOString(),
      kind: "system",
      title: prompt ? "Answers queued" : "Question dismissed",
      text: "",
      detail: "",
      status: "completed",
    };
    this.#store.reserveAgentAction(request, next, {
      ...(delivery ? { add: delivery } : {}),
      resolution,
    });
    const savedResolution = this.#store.agentItem(info.id, resolution.id);
    if (savedResolution) this.#emit({ type: "agent.item", item: savedResolution });
    this.#emit({ type: "agent.state", agent: next });
    void this.drain(info.id).catch((error) => this.fail(info.id, error));
    return this.result(request, info.id);
  }
  private result(request: AgentRequest, id: string, before?: number, after?: number): AgentResult {
    return {
      type: "agent.result",
      requestId: request.requestId,
      outcome: { status: "ok", conversation: this.#store.agentConversation(id, before, after) },
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
    const source = ObjectValue.parse(raw);
    if (
      source["type"] === "agentMessage" &&
      source["delivery"] === "async" &&
      Array.isArray(source["questions"])
    ) {
      const sourceItemId = String(source["id"]),
        info = this.#store.agent(id);
      if (
        !info.pending.some((p) => p.sourceItemId === sourceItemId) &&
        !this.#store.agentItem(id, `async-response:${sourceItemId}`)
      ) {
        if (info.pending.length >= 16) throw new Error("Too many pending agent questions");
        const questions = source["questions"].slice(0, 32).map((rawQuestion, index) => {
          const q = ObjectValue.parse(rawQuestion);
          return AgentQuestionSchema.parse({
            id: String(index),
            header: `Question ${index + 1}`,
            question: q["title"],
            allowOther: true,
            options: (Array.isArray(q["options"]) ? q["options"] : []).map((label) => ({
              label: String(label),
              description: "",
            })),
          });
        });
        if (questions.length)
          this.update(id, {
            pending: [
              ...info.pending,
              {
                id: randomUUID(),
                turnId,
                sourceItemId,
                asynchronous: true,
                kind: "questions",
                title: "Codex has a question",
                summary: "Your answers will be sent as a follow-up. The current work can continue.",
                detail: "",
                decisions: ["decline"],
                decisionLabels: { decline: "Dismiss" },
                questions,
              },
            ],
          });
      }
    }
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
    if (method === "session/disconnected") {
      const runtime = this.#runtimes.get(id);
      if (runtime) {
        runtime.closed = true;
        this.#runtimes.delete(id);
        void runtime.provider.close();
      }
      return;
    }
    if (method === "turn/nativeIdentity" && info.turnId) {
      const nativeId = z.string().min(1).max(4096).parse(params["nativeTurnId"]);
      this.#store.mapNativeTurn(id, nativeId, info.turnId);
      return;
    }
    if (method === "session/models/updated") {
      this.update(id, {
        models: parseModels(params["models"], this.registry.config(info.provider).models),
      });
      return;
    }
    if (method === "session/controls/updated") {
      const controls = AgentControlsSchema.parse(params["controls"]);
      this.update(id, {
        controls,
        ...(controls.currentMode
          ? {
              settings: { ...(info.settings ?? defaultSettings), nativeMode: controls.currentMode },
            }
          : {}),
      });
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
          value.reject(
            Object.assign(new Error("Request was resolved by the provider"), {
              name: "AgentInputResolvedError",
            }),
          );
        }
      const pending = info.pending.filter((p) => p.asynchronous || runtime.pending.has(p.id));
      if (pending.length !== info.pending.length)
        this.update(id, {
          pending,
          status: pending.some((p) => !p.asynchronous) ? "needs_input" : "working",
        });
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
        pending: info.pending.filter((p) => p.asynchronous),
        queuePaused: turn.status === "completed" ? (info.queuePaused ?? false) : true,
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
    const params = ObjectValue.parse(raw);
    const info = this.#store.agent(id);
    const elicitation = method === "mcpServer/elicitation/request";
    const scope = Scope.parse(
      elicitation ? { ...params, turnId: params["turnId"] ?? info.turnId } : raw,
    );
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
      !elicitation &&
      !["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method)
    )
      throw new Error(`Unsupported input request: ${method}`);
    const pending: AgentPending = {
      id: randomUUID(),
      turnId: scope.turnId,
      kind: elicitation ? "elicitation" : questions ? "questions" : "approval",
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
      decisions: questions ? ["decline", "cancel"] : ["accept", "decline", "cancel"],
      questions: questions
        ? z
            .array(AgentQuestionSchema)
            .max(32)
            .parse(
              (Array.isArray(params["questions"]) ? params["questions"] : []).map((raw) => {
                const q = ObjectValue.parse(raw);
                return {
                  ...q,
                  ...(typeof q["isOther"] === "boolean" && q["allowOther"] === undefined
                    ? { allowOther: q["isOther"] }
                    : {}),
                };
              }),
            )
        : [],
    };
    if (elicitation) {
      const schema = ObjectValue.parse(params["requestedSchema"] ?? {});
      const url =
        typeof params["url"] === "string" && /^https?:\/\//i.test(params["url"])
          ? params["url"]
          : undefined;
      pending.title = `${String(params["serverName"] ?? "MCP server")} needs your input`;
      pending.summary = String(params["message"] ?? "").slice(0, 4000);
      pending.elicitation = { schema, ...(url ? { url } : {}) };
      pending.questions = elicitationQuestions(schema);
      pending.decisions = ["decline", "cancel"];
    }
    if (params["decisionLabels"])
      pending.decisionLabels = z
        .object({
          accept: z.string().max(100).optional(),
          decline: z.string().max(100).optional(),
          cancel: z.string().max(100).optional(),
        })
        .parse(params["decisionLabels"]);
    if (questions && !pending.decisionLabels?.decline)
      pending.decisionLabels = { ...pending.decisionLabels, decline: "Dismiss" };
    const choices = pending.kind === "approval" ? approvalActions(params) : undefined;
    if (choices) {
      pending.actions = choices.actions.map((action) => ({
        ...action,
        label: pending.decisionLabels?.[action.decision] ?? action.label,
      }));
      pending.decisions = [...new Set(choices.actions.map((action) => action.decision))];
      if (params["approvalKind"] === "plan" || params["approvalKind"] === "mode") {
        pending.approvalKind = params["approvalKind"];
        pending.title =
          params["approvalKind"] === "plan" ? "Review the agent’s plan" : "Change agent mode?";
        if (typeof params["plan"] === "string") pending.plan = params["plan"].slice(0, 16000);
      }
    }
    if (!choices && Array.isArray(params["availableDecisions"]))
      pending.decisions = pending.decisions.filter((d) =>
        (params["availableDecisions"] as unknown[]).includes(d),
      );
    const result = new Promise<unknown>((resolve, reject) =>
      runtime.pending.set(pending.id, {
        providerId,
        resolve,
        reject,
        ...(choices ? { nativeDecisions: choices.values } : {}),
      }),
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
    await this.accounts.close();
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
