import { randomUUID } from "node:crypto";
import { z } from "zod";

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
export const modelCatalog = (models: { id: string; label: string; efforts?: string[] }[]) => ({
  data: models.slice(0, 100).map((m) => ({
    model: m.id,
    displayName: m.label,
    supportedReasoningEfforts: (m.efforts ?? []).map((reasoningEffort) => ({ reasoningEffort })),
    defaultReasoningEffort: null,
  })),
});
export abstract class EventProvider implements ConversationProvider {
  protected threadId = "";
  protected turnId = "";
  protected closed = false;
  protected interrupted = false;
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
    this.emit("turn/completed", {
      turn: {
        id: this.turnId,
        status: this.interrupted ? "interrupted" : error ? "failed" : "completed",
        items: [],
        ...(error ? { error: { message: error } } : {}),
      },
    });
    this.turnId = "";
  }
  protected item(item: Record<string, unknown>, done = true) {
    this.emit(done ? "item/completed" : "item/started", { item });
  }
  protected tool(
    id: string,
    name: string,
    input: unknown,
    output: unknown,
    done: boolean,
    failed = false,
  ) {
    this.item(
      {
        id,
        type: "mcpToolCall",
        tool: name,
        arguments: input,
        result: output,
        status: failed ? "failed" : done ? "completed" : "inProgress",
      },
      done,
    );
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
    return result["decision"] === "accept";
  }
}
