import { openCodeMcp } from "./mcp.ts";
import type { McpServer } from "@concors/protocol";
import { openCodeHistory } from "./history.ts";
import { Agent } from "undici";
import { randomBytes } from "node:crypto";
import { sessionOffset } from "./session-page.ts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { AgentControlsSchema } from "@concors/protocol";
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
  private dispatcher = new Agent({ connections: 4 });
  private messages = new Map<string, string>();
  private parts = new Map<string, { messageId: string; text: string; thinking: boolean }>();
  private cwd: string;
  private mcp: McpServer[];
  private launcher: typeof launch;
  private models = new Map<string, Record<string, unknown>>();
  private currentModel = "";
  private summaries = new Set<string>();
  private manualCompact = false;
  constructor(
    cwd: string,
    onInput: InputHandler,
    launcher: typeof launch = launch,
    mcp: McpServer[] = [],
  ) {
    super(onInput);
    this.cwd = cwd;
    this.mcp = mcp;
    this.launcher = launcher;
    this.controls = AgentControlsSchema.parse({
      history: true,
      childHistory: true,
      importSessions: true,
      fork: true,
      rewind: ["both"],
      compact: true,
      contextUsage: true,
      mcp: true,
      mcpStatus: true,
      commands: [
        { name: "compact", description: "Summarize earlier context" },
        { name: "summarize", description: "Summarize earlier context" },
      ],
    });
  }
  async initialize() {
    const child = this.launcher(
      "opencode",
      ["serve", "--hostname", "127.0.0.1", "--port", "0"],
      this.cwd,
      {
        ...process.env,
        OPENCODE_SERVER_USERNAME: "concors",
        OPENCODE_SERVER_PASSWORD: this.password,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: "ask",
          ...(this.mcp.length ? { mcp: openCodeMcp(this.mcp) } : {}),
        }),
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
        const health = await this.fetch("/global/health", {
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(1000)]),
        });
        await health.arrayBuffer();
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
        // Own sockets per runtime: a restarted CLI can reuse a recently closed port.
        ...{ dispatcher: this.dispatcher },
        headers: {
          authorization: "Basic " + Buffer.from("concors:" + this.password).toString("base64"),
          "content-type": "application/json",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
      },
    );
    if (!response.ok) throw new Error(`OpenCode request failed (${response.status})`);
    return response;
  }
  private async call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    timeoutMs = 15000,
  ) {
    const response = await this.fetch(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs)]),
    });
    return response.status === 204 ? {} : ((await response.json()) as unknown);
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw);
    if (method === "mcp/status")
      return {
        servers: Object.entries(object(await this.call("/mcp"))).map(([name, status]) => ({
          name,
          status: string(object(status)["status"]),
        })),
      };
    if (method === "session/child-history")
      return {
        thread: {
          id: string(p["childId"]),
          turns: openCodeHistory(
            array(await this.call(`/session/${encodeURIComponent(string(p["childId"]))}/message`)),
          ),
        },
      };
    if (method === "session/list") {
      const offset = sessionOffset(p["cursor"]);
      const sessions = array(await this.call(`/session?limit=${offset + 101}`));
      return {
        nextCursor: sessions.length > offset + 100 ? String(offset + 100) : null,
        sessions: sessions
          .slice(offset, offset + 100)
          .map(object)
          .filter((s) => s["directory"] === this.cwd)
          .map((s) => ({
            id: string(s["id"]),
            title: string(s["title"]).slice(0, 4000),
            directory: this.cwd,
            updatedAt: new Date(Number(object(s["time"])["updated"])).toISOString(),
          })),
      };
    }
    if (method === "session/fork") {
      const fork = object(
        await this.call(`/session/${encodeURIComponent(this.threadId)}/fork`, {}),
      );
      return { thread: { id: string(fork["id"]), turns: [] } };
    }
    if (method === "session/rewind")
      return this.call(`/session/${encodeURIComponent(this.threadId)}/revert`, {
        messageID: string(p["nativeTurnId"]),
      });
    if (method === "session/controls") {
      try {
        this.controls.modes = array(await this.call("/agent"))
          .map(object)
          .filter((a) => !a["hidden"] && a["mode"] !== "subagent")
          .map((a) => ({
            id: string(a["name"]),
            label: string(a["name"]),
            description: string(a["description"]),
          }));
        const commands = array(await this.call("/command")).map(object);
        this.controls.commands = this.controls.commands.filter(
          (c) => c.name === "compact" || c.name === "summarize",
        );
        for (const c of commands)
          if (c["name"] && !this.controls.commands.some((old) => old.name === c["name"]))
            this.controls.commands.push({
              name: string(c["name"]),
              description: string(c["description"]),
              kind: "command",
            });
      } catch {
        /* Older servers can still use the built-in compaction command. */
      }
      return this.controls;
    }
    if (method === "account/providers") return this.call("/provider");
    if (method === "account/methods") return this.call("/provider/auth");
    if (["account/authorize", "account/callback", "account/key"].includes(method)) {
      const id = encodeURIComponent(string(p["provider"]));
      if (method === "account/key")
        return this.call(`/auth/${id}`, { type: "api", key: string(p["value"]) }, "PUT");
      if (method === "account/authorize")
        return this.call(`/provider/${id}/oauth/authorize`, { method: p["method"] });
      const response = await this.fetch(`/provider/${id}/oauth/callback`, {
        method: "POST",
        body: JSON.stringify({ method: p["method"], ...(p["value"] ? { code: p["value"] } : {}) }),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10 * 60 * 1000)]),
      });
      await response.arrayBuffer();
      return {};
    }
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
              this.models.set(string(provider["id"]) + "/" + string(m["id"]), m);
              const variants = Object.keys(object(m["variants"] ?? {}));
              const limit = object(m["limit"] ?? {})["context"];
              return {
                id: string(provider["id"]) + "/" + string(m["id"]),
                label: string(m["name"]) || string(m["id"]),
                efforts: variants.length ? ["default", ...variants] : [],
                defaultEffort: variants.length ? "default" : null,
                supportsImages:
                  m["attachment"] === true ||
                  object(object(m["modalities"] ?? {})["input"] ?? {})["image"] === true,
                ...(typeof limit === "number" && limit > 0 ? { contextWindow: limit } : {}),
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
      const savedModel = object(session["model"] ?? {});
      this.currentModel =
        string(p["model"]) ||
        (savedModel["providerID"] && (savedModel["modelID"] || savedModel["id"])
          ? `${string(savedModel["providerID"])}/${string(savedModel["modelID"] || savedModel["id"])}`
          : "");
      if (method === "thread/resume") {
        const statuses = object(await this.call("/session/status"));
        const status = statuses[this.threadId];
        if (status && object(status)["type"] !== "idle")
          throw new Error("OpenCode session is still running; wait before reconnecting");
      }
      return {
        ...(this.currentModel ? { model: this.currentModel } : {}),
        thread: {
          id: this.threadId,
          turns:
            method === "thread/resume"
              ? this.restoredHistory(
                  openCodeHistory(
                    array(
                      await this.call(`/session/${encodeURIComponent(this.threadId)}/message`),
                    ).filter((raw) => {
                      const cutoff = string(object(session["revert"] ?? {})["messageID"]);
                      return !cutoff || string(object(object(raw)["info"])["id"]) < cutoff;
                    }),
                  ),
                )
              : [],
        },
      };
    }
    if (method === "turn/interrupt") {
      this.interrupted = true;
      const ended = this.waitForEnd();
      await this.call(`/session/${encodeURIComponent(this.threadId)}/abort`, {});
      if (!(await ended)) {
        this.finish();
        this.disconnected();
      }
      this.finish();
      return {};
    }
    if (method === "command/execute") {
      const name = string(p["name"]);
      if (!this.controls.commands.some((c) => c.name === name))
        throw new Error("Unknown OpenCode command");
      const model = string(p["model"]) || this.currentModel,
        slash = model.indexOf("/");
      const compact = name === "compact" || name === "summarize";
      if (compact && slash < 1)
        throw new Error("Select a model or send a message before compacting this session.");
      if (compact && string(p["args"]))
        throw new Error("OpenCode compaction does not accept additional instructions.");
      const result = this.begin(),
        turnId = this.turnId;
      this.manualCompact = compact;
      if (compact) this.startCompaction();
      void this.call(
        `/session/${encodeURIComponent(this.threadId)}/${compact ? "summarize" : "command"}`,
        compact
          ? { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
          : {
              command: name,
              arguments: string(p["args"]),
              ...(model ? { model } : {}),
              ...(p["nativeMode"] ? { agent: p["nativeMode"] } : {}),
            },
        "POST",
        300000,
      )
        .then((response) => {
          if (compact && response !== true && this.compactionId)
            throw new Error("OpenCode did not confirm compaction.");
          if (turnId !== this.turnId) return;
          if (compact) this.endCompaction();
          this.manualCompact = false;
          this.finish();
        })
        .catch((error: Error) => {
          if (turnId === this.turnId) {
            this.manualCompact = false;
            this.endCompaction(error.message);
            this.finish(error.message);
          }
        });
      return result;
    }
    if (method !== "turn/start") throw new Error(`Unsupported OpenCode operation: ${method}`);
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("OpenCode uses tool approvals in Concors");
    const model = string(p["model"]),
      slash = model.indexOf("/");
    if (model && slash < 1) throw new Error("Invalid OpenCode model");
    if (model) this.currentModel = model;
    const parts = [];
    for (const value of array(p["input"])) {
      const item = object(value);
      if (item["type"] === "text") parts.push({ type: "text", text: string(item["text"]) });
      if (item["type"] === "localImage") {
        const capabilities = this.models.get(this.currentModel);
        if (
          !capabilities ||
          !(
            capabilities["attachment"] === true ||
            object(object(capabilities["modalities"] ?? {})["input"] ?? {})["image"] === true
          )
        ) {
          parts.push({
            type: "text",
            text: `Image available on this machine at: ${string(item["path"])}`,
          });
          continue;
        }
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
    this.summaries.clear();
    this.manualCompact = false;
    const messageID = `msg_${Date.now().toString(16)}${randomBytes(10).toString("hex")}`;
    this.emit("turn/nativeIdentity", { nativeTurnId: messageID });
    await this.call(`/session/${encodeURIComponent(this.threadId)}/prompt_async`, {
      messageID,
      parts,
      ...(p["nativeMode"] ? { agent: p["nativeMode"] } : {}),
      ...(p["effort"] && p["effort"] !== "default" ? { variant: p["effort"] } : {}),
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
      if (
        info["summary"] === true ||
        info["agent"] === "compaction" ||
        info["mode"] === "compaction" ||
        (this.manualCompact && info["role"] === "assistant")
      )
        this.summaries.add(string(info["id"]));
      if (info["role"] === "assistant") {
        if (info["providerID"] && info["modelID"]) {
          this.currentModel = string(info["providerID"]) + "/" + string(info["modelID"]);
          this.emit("session/model/updated", { model: this.currentModel });
        }
        this.updateUsage(info["tokens"]);
      }
      if (info["error"]) this.finish(string(object(info["error"])["message"]) || "OpenCode failed");
    }
    if (e["type"] === "message.part.updated") {
      const part = object(p["part"]);
      if (part["sessionID"] !== this.threadId) return;
      const id = string(part["id"]);
      if (part["type"] === "compaction") this.startCompaction();
      if (part["type"] === "step-finish") this.updateUsage(part["tokens"]);
      if (this.summaries.has(string(part["messageID"])) || this.manualCompact) return;
      if (part["type"] === "text" || part["type"] === "reasoning")
        this.parts.set(id, {
          messageId: string(part["messageID"]),
          text: string(part["text"]),
          thinking: part["type"] === "reasoning",
        });
      if (
        ["text", "reasoning"].includes(string(part["type"])) &&
        this.messages.get(string(part["messageID"])) === "assistant"
      )
        this.item(
          part["type"] === "reasoning"
            ? { id, type: "reasoning", summary: [string(part["text"])] }
            : { id, type: "agentMessage", text: string(part["text"]) },
          !!part["time"] && !!object(part["time"])["end"],
        );
      if (part["type"] === "tool") {
        const state = object(part["state"]);
        this.tool(
          id,
          string(part["tool"]),
          state["input"],
          { content: state["output"] ?? state["error"], details: state["metadata"] },
          state["status"] === "completed" || state["status"] === "error",
          state["status"] === "error",
        );
      }
    }
    if (p["sessionID"] !== this.threadId) return;
    if (e["type"] === "message.part.delta" && p["field"] === "text") {
      const id = string(p["partID"]),
        part = this.parts.get(id);
      if (this.manualCompact || (part && this.summaries.has(part.messageId))) return;
      if (part && this.messages.get(part.messageId) === "assistant") {
        part.text += string(p["delta"]);
        this.item(
          part.thinking
            ? { id, type: "reasoning", summary: [part.text] }
            : { id, type: "agentMessage", text: part.text },
          false,
        );
      }
    }

    if (e["type"] === "todo.updated")
      this.item(
        { id: `tasks:${this.threadId}:${this.turnId}`, type: "plan", steps: array(p["todos"]) },
        false,
      );
    if (e["type"] === "session.status") {
      const status = object(p["status"] ?? {});
      if (status["type"] === "retry")
        this.item(
          {
            id: `retry:${this.turnId}`,
            type: "notification",
            title: "Retrying",
            text: string(status["message"]) || "Waiting for the provider before retrying.",
          },
          false,
        );
    }
    // Keep reading SSE while waiting for user input; an interrupt/completion can resolve it.
    if (e["type"] === "permission.asked")
      void this.onInput(
        "item/commandExecution/requestApproval",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          reason: string(p["permission"]),
          command: JSON.stringify(p["patterns"]),
          actions: [
            { id: "once", label: "Allow once", decision: "accept" },
            { id: "always", label: "Always allow", decision: "accept" },
            { id: "reject", label: "Decline", decision: "decline" },
            { id: "cancel", label: "Cancel turn", decision: "cancel" },
          ],
        },
        string(p["id"]),
      )
        .then((raw) => {
          const response = object(raw);
          return this.call(`/permission/${encodeURIComponent(string(p["id"]))}/reply`, {
            reply:
              response["decision"] === "accept" && !this.interrupted
                ? response["actionId"] === "always"
                  ? "always"
                  : "once"
                : "reject",
          });
        })
        .catch((error) => {
          if (
            this.turnId &&
            !this.interrupted &&
            !(error instanceof Error && error.name === "AgentInputResolvedError")
          )
            this.fail(error);
        });
    if (e["type"] === "question.asked")
      void (async () => {
        const questions = array(p["questions"]).map((value, index) => {
          const q = object(value);
          return {
            id: String(index),
            header: string(q["header"]),
            question: string(q["question"]),
            ...(typeof q["multiple"] === "boolean" ? { multiSelect: q["multiple"] } : {}),
            ...(typeof q["custom"] === "boolean" ? { allowOther: q["custom"] } : {}),
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
        if (result["decision"] === "decline" || result["decision"] === "cancel") {
          await this.call(`/question/${encodeURIComponent(string(p["id"]))}/reject`, {});
          return;
        }
        const answers = object(result["answers"]);
        await this.call(`/question/${encodeURIComponent(string(p["id"]))}/reply`, {
          answers: questions.map((q) => array(object(answers[q.id])["answers"])),
        });
      })().catch((error) => {
        if (this.turnId && !(error instanceof Error && error.name === "AgentInputResolvedError"))
          this.fail(error);
      });
    if (["permission.replied", "question.replied", "question.rejected"].includes(string(e["type"])))
      this.emit("serverRequest/resolved", { requestId: p["requestID"] ?? p["id"] });
    if (e["type"] === "session.compacted") this.endCompaction();
    if (e["type"] === "session.idle" && !this.manualCompact) this.finish();
    if (e["type"] === "session.error") this.finish(JSON.stringify(p["error"]));
  }
  private updateUsage(raw: unknown) {
    if (!raw || this.manualCompact) return;
    const tokens = object(raw),
      cache = object(tokens["cache"] ?? {});
    const used = [
      tokens["input"],
      tokens["output"],
      tokens["reasoning"],
      cache["read"],
      cache["write"],
    ].reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
    const limit = object(this.models.get(this.currentModel)?.["limit"] ?? {})["context"];
    if (used > 0) this.usage(used, typeof limit === "number" ? limit : null);
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    await this.dispatcher.destroy();
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
