import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonlFrameDecoder } from "./jsonl-frame-decoder.ts";
export class JsonLines {
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ended = false;
  private startupProblem: string | undefined;
  private exit: Promise<void>;
  private child: ChildProcessWithoutNullStreams;
  private event: (value: Record<string, unknown>) => void;
  private failure: (error: Error) => void;
  constructor(
    child: ChildProcessWithoutNullStreams,
    event: (value: Record<string, unknown>) => void,
    failure: (error: Error) => void,
  ) {
    this.child = child;
    this.event = event;
    this.failure = failure;
    this.exit = new Promise((resolve) => child.once("close", () => resolve()));
    child.stdout.setEncoding("utf8");
    const decoder = new JsonlFrameDecoder({
      frame: (frame) => {
        const pending = this.pending.get(String(frame["id"]));
        if (frame["type"] === "response" && pending) {
          this.pending.delete(String(frame["id"]));
          clearTimeout(pending.timer);
          if (frame["success"] === true) pending.resolve(frame["data"]);
          else pending.reject(new Error(String(frame["error"] ?? "Provider request failed")));
        } else this.event(frame);
      },
      problem: (problem) => this.fail(new Error(`Invalid provider frame: ${problem}`)),
    });
    child.stdout.on("data", (chunk: string) => {
      try {
        decoder.write(chunk);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.on("error", (e) => this.fail(e));
    child.on("error", (e) => this.fail(e));
    child.on("close", (code) =>
      this.fail(
        new Error(this.startupProblem ?? `Provider process exited (code ${code ?? "unknown"})`),
      ),
    );
    child.stderr.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("No models available"))
        this.startupProblem =
          "No models available. Sign in with this provider's CLI on this machine.";
    });
  }
  private fail(error: Error) {
    if (this.ended) return;
    this.ended = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.failure(error);
    this.child.kill();
  }
  write(value: unknown) {
    if (this.ended) throw new Error("Provider is disconnected");
    const frame = JSON.stringify(value) + "\n";
    if (
      Buffer.byteLength(frame) > 2 * 1024 * 1024 ||
      this.child.stdin.writableLength > 2 * 1024 * 1024
    )
      throw new Error("Provider write limit exceeded");
    this.child.stdin.write(frame);
  }
  request(type: string, params: Record<string, unknown> = {}, timeoutMs = 15000) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.pending.size >= 32) {
        reject(new Error("Too many provider requests"));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Provider ${type} timed out; request was not retried`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, type, ...params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async close() {
    this.fail(new Error("Provider connection closed"));
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    try {
      await this.exit;
    } finally {
      clearTimeout(timer);
    }
  }
}
