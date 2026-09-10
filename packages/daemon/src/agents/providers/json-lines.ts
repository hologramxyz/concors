import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { object } from "./contract.ts";
export class JsonLines {
  private buffer = "";
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private ended = false;
  private exit: Promise<void>;
  constructor(
    private child: ChildProcessWithoutNullStreams,
    private event: (value: Record<string, unknown>) => void,
    private failure: (error: Error) => void,
  ) {
    this.exit = new Promise((resolve) => child.once("close", () => resolve()));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      try {
        this.buffer += chunk;
        let index;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + 1);
          if (Buffer.byteLength(line) > 2 * 1024 * 1024)
            throw new Error("Provider frame too large");
          if (!line.trim()) continue;
          const frame = object(JSON.parse(line));
          const pending = this.pending.get(String(frame["id"]));
          if (frame["type"] === "response" && pending) {
            this.pending.delete(String(frame["id"]));
            clearTimeout(pending.timer);
            if (frame["success"] === true) pending.resolve(frame["data"]);
            else pending.reject(new Error(String(frame["error"] ?? "Provider request failed")));
          } else this.event(frame);
        }
        if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024)
          throw new Error("Provider frame too large");
      } catch (e) {
        this.fail(e instanceof Error ? e : new Error(String(e)));
      }
    });
    child.stdin.on("error", (e) => this.fail(e));
    child.on("error", (e) => this.fail(e));
    child.on("close", () => this.fail(new Error("Provider process exited")));
    child.stderr.resume();
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
  request(type: string, params: Record<string, unknown> = {}) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.pending.size >= 32) {
        reject(new Error("Too many provider requests"));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Provider ${type} timed out; request was not retried`));
      }, 15000);
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
