import { TaskState, isTaskTool } from "./plans.ts";
import { nativeToolItem } from "./tool-items.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentPlanUsage } from "@concors/protocol";
import { AgentControlsSchema, type AgentControls } from "@concors/protocol";

export type InputHandler = (
  method: string,
  params: unknown,
  id: string | number,
) => Promise<unknown>;
/** Internal conversation transport. Codex supplies these frames natively; other adapters normalize
 * their native events here, keeping persistence, request receipts and client state shared. */
export interface ConversationProvider {
  initialize(): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
  onFailure(listener: (error: Error) => void): void;
  close(): Promise<void>;
  /**
   * What is left of the account's plan, asked of the provider when someone looks. Providers
   * without the notion leave it out, and the machine reports that instead of guessing.
   */
  planUsage?(): Promise<AgentPlanUsage>;
}
export const object = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const textContent = (value: unknown): string =>
  typeof value === "string"
    ? value
    : array(value)
        .map((v) => string(object(v)["text"]))
        .filter(Boolean)
        .join("\n");
export const modelCatalog = (
  models: {
    id: string;
    label: string;
    resolvedModel?: string;
    isDefault?: boolean;
    description?: string;
    efforts?: string[];
    defaultEffort?: string | null;
    supportsImages?: boolean;
    contextWindow?: number;
  }[],
) => ({
  data: models.map((m) => ({
    model: m.id,
    displayName: m.label,
    ...(m.resolvedModel ? { resolvedModel: m.resolvedModel } : {}),
    ...(m.isDefault === undefined ? {} : { isDefault: m.isDefault }),
    ...(m.description ? { description: m.description } : {}),
    supportedReasoningEfforts: (m.efforts ?? []).map((reasoningEffort) => ({ reasoningEffort })),
    defaultReasoningEffort: m.defaultEffort ?? null,
    ...(m.supportsImages === undefined ? {} : { supportsImages: m.supportsImages }),
    ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
  })),
});
export abstract class EventProvider implements ConversationProvider {
  protected threadId = "";
  protected turnId = "";
  protected closed = false;
  protected interrupted = false;
  protected tasks = new TaskState();
  protected controls: AgentControls = AgentControlsSchema.parse({});
  protected compactionId: string | null = null;
  private ended = new Set<() => void>();
  protected waitForEnd(timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.ended.delete(done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.ended.delete(done);
        resolve(false);
      }, timeoutMs);
      this.ended.add(done);
    });
  }
  protected disconnected() {
    this.emit("session/disconnected", {});
  }
  private notifications = new Set<(method: string, params: unknown) => void>();
  private failures = new Set<(error: Error) => void>();
  protected readonly onInput: InputHandler;
  constructor(onInput: InputHandler) {
    this.onInput = onInput;
  }
  abstract initialize(): Promise<void>;
  abstract request(method: string, params?: unknown): Promise<unknown>;
  abstract close(): Promise<void>;
  onNotification(fn: (method: string, params: unknown) => void) {
    this.notifications.add(fn);
    return () => {
      this.notifications.delete(fn);
    };
  }
  onFailure(fn: (error: Error) => void) {
    this.failures.add(fn);
  }
  protected fail(error: unknown) {
    if (!this.closed)
      for (const fn of this.failures) fn(error instanceof Error ? error : new Error(String(error)));
  }
  protected emit(method: string, params: Record<string, unknown>) {
    if (!this.closed)
      for (const fn of this.notifications)
        fn(method, { threadId: this.threadId, turnId: this.turnId, ...params });
  }
  protected begin() {
    if (this.turnId) throw new Error("A turn is already running");
    this.interrupted = false;
    this.turnId = randomUUID();
    this.emit("turn/started", { turn: { id: this.turnId, status: "inProgress", items: [] } });
    return { turn: { id: this.turnId, status: "inProgress", items: [] } };
  }
  protected finish(error?: string) {
    if (!this.turnId) return;
    if (this.compactionId)
      this.endCompaction(
        error ?? (this.interrupted ? "Interrupted" : "No compaction result was reported."),
      );
    this.emit("turn/completed", {
      turn: {
        id: this.turnId,
        status: this.interrupted ? "interrupted" : error ? "failed" : "completed",
        items: [],
        ...(error ? { error: { message: error } } : {}),
      },
    });
    this.turnId = "";
    for (const done of this.ended) done();
  }
  protected item(item: Record<string, unknown>, done = true) {
    if (!this.turnId) return;
    this.emit(done ? "item/completed" : "item/started", { item });
  }
  protected startCompaction() {
    if (this.compactionId) return;
    this.compactionId = randomUUID();
    this.item({ id: this.compactionId, type: "contextCompaction", status: "inProgress" }, false);
  }
  protected endCompaction(error?: string) {
    if (!this.compactionId) return;
    this.item({
      id: this.compactionId,
      type: "contextCompaction",
      status: error ? (this.interrupted ? "interrupted" : "failed") : "completed",
      message: error ?? "Earlier context was summarized.",
    });
    this.compactionId = null;
  }
  protected usage(used: number, limit: number | null, total: number | null = null) {
    if (
      !Number.isFinite(used) ||
      used < 0 ||
      (total !== null && (!Number.isFinite(total) || total < 0))
    )
      return;
    this.emit("thread/tokenUsage/updated", {
      tokenUsage: {
        last: { totalTokens: used },
        total: { totalTokens: total },
        modelContextWindow: limit && Number.isFinite(limit) && limit > 0 ? limit : null,
      },
    });
  }
  protected restoredHistory<T extends { items: unknown[] }>(turns: T[]): T[] {
    this.tasks.restore(turns);
    return turns;
  }
  protected controlsChanged() {
    this.emit("session/controls/updated", { controls: this.controls });
  }
  protected tool(
    id: string,
    name: string,
    input: unknown,
    output: unknown,
    done: boolean,
    failed = false,
  ) {
    if (isTaskTool(name)) {
      if (!done) return;
      const steps = this.tasks.update(name, input, output, done, failed);
      if (steps) {
        this.item({ id: `tasks:${id}`, type: "plan", steps }, false);
        return;
      }
    }
    this.item(nativeToolItem(id, name, input, output, done, failed), done);
  }
  protected async permission(title: string, input: unknown): Promise<boolean> {
    const result = object(
      await this.onInput(
        "item/commandExecution/requestApproval",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          reason: title,
          command: JSON.stringify(input),
          availableDecisions: ["accept", "decline", "cancel"],
        },
        randomUUID(),
      ),
    );
    return !this.interrupted && !this.closed && result["decision"] === "accept";
  }
}
