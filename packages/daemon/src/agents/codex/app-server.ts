import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";

const Frame = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).passthrough().optional(),
});
type RequestHandler = (
  method: string,
  params: unknown,
  requestId: string | number,
) => Promise<unknown>;
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Codex's newline-delimited JSON-RPC transport, following Paseo's app-server separation.
 * Owns only transport lifetime. Session persistence and UI decisions belong to the caller.
 */
export class CodexAppServer {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, Pending>();
  readonly #notifications = new Set<(method: string, params: unknown) => void>();
  readonly #requestHandler: RequestHandler | undefined;
  readonly #failures = new Set<(error: Error) => void>();
  #nextId = 0;
  #buffer = "";
  #stderr = "";
  #failure: Error | null = null;
  #ready = false;
  #connecting: Promise<void> | null = null;
  #closing: Promise<void> | null = null;
  #exit: Promise<void>;
  #resolveExit: () => void = () => undefined;
  #incomingRequests = 0;

  constructor(child: ChildProcessWithoutNullStreams, onRequest?: RequestHandler) {
    this.#child = child;
    this.#requestHandler = onRequest;
    this.#exit = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.read(data));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => {
      this.#stderr = (this.#stderr + data).slice(-4096);
    });
    child.stdin.on("error", (error: Error) => this.fail(error));
    child.on("error", (error: Error) => this.fail(error));
    child.on("close", (code, signal) => {
      this.fail(
        new Error(`Codex app server exited (${signal ?? code ?? "unknown"}). ${this.#stderr}`),
      );
      this.#resolveExit();
    });
  }
  onFailure(listener: (error: Error) => void): void {
    this.#failures.add(listener);
  }
  initialize(): Promise<void> {
    this.#connecting ??= (async () => {
      await this.rpc("initialize", {
        clientInfo: { name: "concors", title: "Concors", version: "0.1.0" },
      });
      this.write({ method: "initialized", params: {} });
      this.#ready = true;
    })();
    return this.#connecting;
  }
  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.#notifications.add(listener);
    return () => {
      this.#notifications.delete(listener);
    };
  }
  request(method: string, params: unknown = {}, timeoutMs = 30000): Promise<unknown> {
    if (!this.#ready) return Promise.reject(new Error("Initialize the Codex app server first"));
    return this.rpc(method, params, timeoutMs);
  }
  private rpc(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#pending.size >= 64)
      return Promise.reject(new Error("Too many pending Codex requests"));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new Error("Invalid request timeout"));
    return new Promise((resolve, reject) => {
      const id = ++this.#nextId;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(
            `Codex ${method} timed out; outcome is unknown. Requests are not retried automatically.`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }
  private write(value: unknown): void {
    if (this.#failure) throw this.#failure;
    const frame = JSON.stringify(value) + "\n";
    if (
      Buffer.byteLength(frame) > 2 * 1024 * 1024 ||
      this.#child.stdin.writableLength > 2 * 1024 * 1024
    )
      throw new Error("Codex transport write limit exceeded");
    this.#child.stdin.write(frame);
  }
  private read(chunk: string): void {
    if (this.#failure) return;
    this.#buffer += chunk;
    let boundary: number;
    while ((boundary = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + 1);
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) {
        this.fail(new Error("Codex frame exceeds 2 MiB"));
        return;
      }
      if (!line.trim()) continue;
      try {
        this.receive(Frame.parse(JSON.parse(line)));
      } catch {
        this.fail(new Error("Invalid Codex app-server frame"));
        return;
      }
    }
    if (Buffer.byteLength(this.#buffer) > 2 * 1024 * 1024)
      this.fail(new Error("Codex frame exceeds 2 MiB"));
  }
  private receive(frame: z.infer<typeof Frame>): void {
    if (frame.method) {
      if (frame.id !== undefined) {
        if (this.#incomingRequests >= 16) {
          this.fail(new Error("Too many Codex input requests"));
          return;
        }
        this.#incomingRequests++;
        const method = frame.method;
        const requestId = frame.id;
        // Unknown approval/input requests are errors, never implicit approvals.
        void Promise.resolve()
          .then(() => {
            if (!this.#requestHandler)
              throw new Error(`Unsupported Codex request: ${frame.method}`);
            return this.#requestHandler(method, frame.params, requestId);
          })
          .then(
            (result) => {
              if (!this.#failure) this.write({ id: frame.id, result });
            },
            (error: unknown) => {
              if (!this.#failure)
                this.write({
                  id: frame.id,
                  error: {
                    code: -32601,
                    message: error instanceof Error ? error.message : "Input request failed",
                  },
                });
            },
          )
          .catch((error: unknown) =>
            this.fail(error instanceof Error ? error : new Error("Codex response failed")),
          )
          .finally(() => {
            this.#incomingRequests--;
          });
      } else for (const listener of this.#notifications) listener(frame.method, frame.params);
      return;
    }
    if (frame.id === undefined || (!("result" in frame) && !frame.error))
      throw new Error("Invalid response");
    const pending = typeof frame.id === "number" ? this.#pending.get(frame.id) : undefined;
    if (!pending) return; // A response can arrive after its caller timed out.
    this.#pending.delete(Number(frame.id));
    clearTimeout(pending.timer);
    if (frame.error) pending.reject(new Error(frame.error.message));
    else pending.resolve(frame.result);
  }
  private fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    this.#ready = false;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#buffer = "";
    for (const listener of this.#failures) listener(error);
    this.#failures.clear();
    if (this.#child.exitCode === null && !this.#child.killed) this.#child.kill();
  }
  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.fail(new Error("Codex connection closed"));
      this.#child.stdin.end();
      const timer = setTimeout(() => {
        this.#child.kill("SIGKILL");
      }, 2000);
      try {
        await this.#exit;
      } finally {
        clearTimeout(timer);
        this.#notifications.clear();
      }
    })();
    return this.#closing;
  }
}
