import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  query,
  type Query,
  type SDKUserMessage,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { resolveProfile } from "../../terminal/profiles.ts";
import {
  EventProvider,
  array,
  object,
  string,
  textContent,
  modelCatalog,
  type InputHandler,
} from "./contract.ts";

export class ClaudeProvider extends EventProvider {
  private session: Query | undefined;
  private pending: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private generation = 0;
  private tools = new Map<string, { name: string; input: unknown }>();
  private messageId = "";
  private text = "";
  constructor(
    private readonly cwd: string,
    onInput: InputHandler,
    private readonly createQuery = query,
  ) {
    super(onInput);
  }
  async initialize() {
    await this.open();
  }
  private async open(resume?: string) {
    this.generation++;
    this.session?.close();
    this.wake?.();
    this.pending = [];
    this.threadId = resume ?? randomUUID();
    const generation = this.generation;
    const self = this;
    async function* prompts(): AsyncGenerator<SDKUserMessage> {
      while (!self.closed && generation === self.generation) {
        const item = self.pending.shift();
        if (item) yield item;
        else
          await new Promise<void>((resolve) => {
            self.wake = resolve;
          });
      }
    }
    const executable = resolveProfile("claude").command;
    const options: Options = {
      cwd: this.cwd,
      pathToClaudeCodeExecutable: executable,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      permissionMode: "default",
      ...(resume ? { resume } : { sessionId: this.threadId }),
      canUseTool: async (name, input) => {
        if (name === "AskUserQuestion") {
          const questions = array(input["questions"])
            .slice(0, 3)
            .map((raw, index) => {
              const q = object(raw);
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
          const response = object(
            await this.onInput(
              "item/tool/requestUserInput",
              { threadId: this.threadId, turnId: this.turnId, questions },
              randomUUID(),
            ),
          );
          const answers = object(response["answers"]);
          return {
            behavior: "allow",
            updatedInput: {
              ...input,
              answers: Object.fromEntries(
                questions.map((q) => [
                  q.question,
                  array(object(answers[q.id])["answers"]).join(", "),
                ]),
              ),
            },
          };
        }
        return (await this.permission(name, input))
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Declined in Concors" };
      },
    };
    const session = this.createQuery({ prompt: prompts(), options });
    this.session = session;
    void (async () => {
      try {
        for await (const message of session) {
          if (generation !== this.generation || this.closed) return;
          this.event(object(message));
        }
        if (this.turnId) this.finish("Claude Code stopped before completing the turn");
      } catch (error) {
        if (generation === this.generation && !this.closed) {
          if (this.interrupted) this.finish();
          else this.fail(error);
        }
      }
    })();
    await session.initializationResult();
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw),
      session = this.session;
    if (!session) throw new Error("Claude Code is disconnected");
    if (method === "model/list")
      return modelCatalog(
        (await session.supportedModels()).map((m) => ({ id: m.value, label: m.displayName })),
      );
    if (method === "collaborationMode/list") return { data: [] };
    if (method === "thread/resume") await this.open(string(p["threadId"]));
    if (method === "thread/start" || method === "thread/resume")
      return { thread: { id: this.threadId, turns: [] } };
    if (method === "turn/interrupt") {
      this.interrupted = true;
      await session.interrupt();
      this.finish();
      return {};
    }
    if (method !== "turn/start") throw new Error(`Unsupported Claude operation: ${method}`);
    await session.setModel(typeof p["model"] === "string" ? p["model"] : undefined);
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("Claude Code uses its normal tool approvals in Concors");
    await session.setPermissionMode("default");
    const content: SDKUserMessage["message"]["content"] = [];
    for (const value of array(p["input"])) {
      const item = object(value);
      if (item["type"] === "text") content.push({ type: "text", text: string(item["text"]) });
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
        content.push({
          type: "image",
          source: { type: "base64", media_type: mime, data: bytes.toString("base64") },
        });
      }
    }
    const result = this.begin();
    this.tools.clear();
    this.messageId = "";
    this.text = "";
    this.pending.push({
      type: "user",
      session_id: this.threadId,
      parent_tool_use_id: null,
      message: { role: "user", content },
    });
    this.wake?.();
    return result;
  }
  private event(m: Record<string, unknown>) {
    if (!this.turnId || m["parent_tool_use_id"]) return;
    if (m["type"] === "stream_event") {
      const e = object(m["event"]);
      if (e["type"] === "message_start") {
        this.messageId = string(object(e["message"])["id"]);
        this.text = "";
      }
      if (e["type"] === "content_block_delta") {
        const d = object(e["delta"]);
        if (d["type"] === "text_delta") {
          this.text += string(d["text"]);
          this.item({ id: this.messageId, type: "agentMessage", text: this.text }, false);
        }
      }
    }
    if (m["type"] === "assistant") {
      const message = object(m["message"]);
      const id = string(message["id"]);
      const content = array(message["content"]);
      const text = textContent(content.filter((v) => object(v)["type"] === "text"));
      if (text) this.item({ id, type: "agentMessage", text });
      for (const value of content) {
        const c = object(value);
        if (c["type"] === "tool_use") {
          const tool = { name: string(c["name"]), input: c["input"] };
          this.tools.set(string(c["id"]), tool);
          this.tool(string(c["id"]), tool.name, tool.input, null, false);
        }
      }
    }
    if (m["type"] === "user")
      for (const value of array(object(m["message"])["content"])) {
        const c = object(value);
        if (c["type"] !== "tool_result") continue;
        const id = string(c["tool_use_id"]),
          tool = this.tools.get(id);
        if (tool) this.tool(id, tool.name, tool.input, c["content"], true, c["is_error"] === true);
      }
    if (m["type"] === "result")
      this.finish(
        m["is_error"] === true
          ? array(m["errors"]).map(String).join("\n") || "Claude Code failed"
          : undefined,
      );
  }
  async close() {
    this.closed = true;
    this.generation++;
    this.wake?.();
    this.session?.close();
  }
}
