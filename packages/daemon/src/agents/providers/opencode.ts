import { randomBytes } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import {
  EventProvider,
  array,
  object,
  string,
  modelCatalog,
  type InputHandler,
} from "./contract.ts";
import { launch } from "./launch.ts";
export class OpenCodeProvider extends EventProvider {
  private child: ChildProcessWithoutNullStreams | undefined;
  private url = "";
  private password = randomBytes(32).toString("hex");
  private abort = new AbortController();
  private messages = new Map<string, string>();
  private parts = new Map<string, { messageId: string; text: string }>();
  private cwd: string;
  constructor(cwd: string, onInput: InputHandler) {
    super(onInput);
    this.cwd = cwd;
  }
  async initialize() {
    const child = launch(
      "opencode",
      ["serve", "--hostname", "127.0.0.1", "--port", "0"],
      this.cwd,
      {
        ...process.env,
        OPENCODE_SERVER_USERNAME: "concors",
        OPENCODE_SERVER_PASSWORD: this.password,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: "ask" }),
      },
    );
    this.child = child;
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("OpenCode server startup timed out")), 15000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timer);
        reject(new Error("OpenCode server stopped"));
        if (!this.closed) this.fail(new Error("OpenCode server stopped"));
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output = (output + chunk).slice(-8192);
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
        if (match) {
          this.url = match[0];
          clearTimeout(timer);
          resolve();
        }
      });
    });
    // The CLI can announce its URL before the HTTP listener accepts connections.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.fetch("/global/health", {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(1000)]),
        });
        break;
      } catch (error) {
        if (attempt >= 9 || this.closed) throw error;
        await delay(100);
      }
    }
    const response = await this.fetch("/event", { signal: this.abort.signal });
    if (!response.body) throw new Error("OpenCode event stream is missing");
    void this.events(response.body).catch((error) => {
      if (!this.closed) this.fail(error);
    });
  }
  private async fetch(path: string, init: RequestInit = {}) {
    const response = await fetch(
      this.url +
        path +
        (path.includes("?") ? "&" : "?") +
        "directory=" +
        encodeURIComponent(this.cwd),
      {
        ...init,
        headers: {
          authorization: "Basic " + Buffer.from("concors:" + this.password).toString("base64"),
          "content-type": "application/json",
          connection: "close",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
      },
    );
    if (!response.ok) throw new Error(`OpenCode request failed (${response.status})`);
    return response;
  }
  private async call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const response = await this.fetch(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.status === 204 ? {} : ((await response.json()) as unknown);
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw);
    if (method === "model/list") {
      const catalog = object(await this.call("/provider"));
      const connected = array(catalog["connected"]);
      return modelCatalog(
        array(catalog["all"])
          .map(object)
          .filter((provider) => connected.includes(provider["id"]))
          .flatMap((provider) =>
            Object.values(object(provider["models"])).map((value) => {
              const m = object(value);
              return {
                id: string(provider["id"]) + "/" + string(m["id"]),
                label: string(m["name"]) || string(m["id"]),
              };
            }),
          ),
      );
    }
    if (method === "collaborationMode/list") return { data: [] };
    if (method === "thread/start" || method === "thread/resume") {
      const session = object(
        await this.call(
          method === "thread/start"
            ? "/session"
            : "/session/" + encodeURIComponent(string(p["threadId"])),
          method === "thread/start"
            ? { title: "Concors", permission: [{ permission: "*", pattern: "*", action: "ask" }] }
            : undefined,
        ),
      );
      this.threadId = string(session["id"]);
      if (!this.threadId) throw new Error("OpenCode did not return a session");
      if (method === "thread/resume") {
        const statuses = object(await this.call("/session/status"));
        const status = statuses[this.threadId];
        if (status && object(status)["type"] !== "idle")
          throw new Error("OpenCode session is still running; wait before reconnecting");
      }
      return { thread: { id: this.threadId, turns: [] } };
    }
    if (method === "turn/interrupt") {
      this.interrupted = true;
      await this.call(`/session/${encodeURIComponent(this.threadId)}/abort`, {});
      this.finish();
      return {};
    }
    if (method !== "turn/start") throw new Error(`Unsupported OpenCode operation: ${method}`);
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("OpenCode uses tool approvals in Concors");
    const model = string(p["model"]),
      slash = model.indexOf("/");
    if (model && slash < 1) throw new Error("Invalid OpenCode model");
    const parts = [];
    for (const value of array(p["input"])) {
      const item = object(value);
      if (item["type"] === "text") parts.push({ type: "text", text: string(item["text"]) });
      if (item["type"] === "localImage") {
        const bytes = await readFile(string(item["path"]));
        const mime =
          bytes[0] === 0x89
            ? "image/png"
            : bytes[0] === 0xff
              ? "image/jpeg"
              : bytes[0] === 0x47
                ? "image/gif"
                : "image/webp";
        parts.push({ type: "file", mime, url: `data:${mime};base64,${bytes.toString("base64")}` });
      }
    }
    const result = this.begin();
    this.messages.clear();
    this.parts.clear();
    await this.call(`/session/${encodeURIComponent(this.threadId)}/prompt_async`, {
      parts,
      ...(model
        ? { model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) } }
        : {}),
    });
    return result;
  }
  private async events(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) await this.event(object(JSON.parse(data)));
        }
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024)
          throw new Error("OpenCode event exceeds size limit");
      }
      if (!this.closed) throw new Error("OpenCode event stream disconnected");
    } finally {
      reader.releaseLock();
    }
  }
  private async event(e: Record<string, unknown>) {
    const p = object(e["properties"] ?? {});
    if (!this.turnId) return;
    if (e["type"] === "message.updated") {
      const info = object(p["info"]);
      if (info["sessionID"] !== this.threadId) return;
      this.messages.set(string(info["id"]), string(info["role"]));
      if (info["error"]) this.finish(string(object(info["error"])["message"]) || "OpenCode failed");
    }
    if (e["type"] === "message.part.updated") {
      const part = object(p["part"]);
      if (part["sessionID"] !== this.threadId) return;
      const id = string(part["id"]);
      if (part["type"] === "text")
        this.parts.set(id, { messageId: string(part["messageID"]), text: string(part["text"]) });
      if (part["type"] === "text" && this.messages.get(string(part["messageID"])) === "assistant")
        this.item(
          { id, type: "agentMessage", text: string(part["text"]) },
          !!part["time"] && !!object(part["time"])["end"],
        );
      if (part["type"] === "tool") {
        const state = object(part["state"]);
        this.tool(
          id,
          string(part["tool"]),
          state["input"],
          state["output"] ?? state["error"],
          state["status"] === "completed" || state["status"] === "error",
          state["status"] === "error",
        );
      }
    }
    if (p["sessionID"] !== this.threadId) return;
    if (e["type"] === "message.part.delta" && p["field"] === "text") {
      const id = string(p["partID"]),
        part = this.parts.get(id);
      if (part && this.messages.get(part.messageId) === "assistant") {
        part.text += string(p["delta"]);
        this.item({ id, type: "agentMessage", text: part.text }, false);
      }
    }

    // Keep reading SSE while waiting for user input; an interrupt/completion can resolve it.
    if (e["type"] === "permission.asked")
      void this.permission(string(p["permission"]), p["patterns"])
        .then((allowed) =>
          this.call(`/permission/${encodeURIComponent(string(p["id"]))}/reply`, {
            reply: allowed ? "once" : "reject",
          }),
        )
        .catch((error) => {
          if (this.turnId) this.fail(error);
        });
    if (e["type"] === "question.asked")
      void (async () => {
        if (array(p["questions"]).length > 3) {
          await this.call(`/question/${encodeURIComponent(string(p["id"]))}/reject`, {});
          return;
        }
        const questions = array(p["questions"]).map((value, index) => {
          const q = object(value);
          return {
            id: String(index),
            header: string(q["header"]),
            question: string(q["question"]),
            options: array(q["options"]).map((v) => {
              const o = object(v);
              return { label: string(o["label"]), description: string(o["description"]) };
            }),
          };
        });
        const result = object(
          await this.onInput(
            "item/tool/requestUserInput",
            { threadId: this.threadId, turnId: this.turnId, questions },
            string(p["id"]),
          ),
        );
        const answers = object(result["answers"]);
        await this.call(`/question/${encodeURIComponent(string(p["id"]))}/reply`, {
          answers: questions.map((q) => array(object(answers[q.id])["answers"])),
        });
      })().catch((error) => {
        if (this.turnId) this.fail(error);
      });
    if (e["type"] === "session.idle") this.finish();
    if (e["type"] === "session.error") this.finish(JSON.stringify(p["error"]));
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      await exit;
    } finally {
      clearTimeout(timer);
    }
  }
}
