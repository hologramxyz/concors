import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  query,
  getSessionMessages,
  type Query,
  type SDKUserMessage,
  type Options,
  type ModelInfo,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { AgentControlsSchema } from "@concors/protocol";
import { claudeHistory } from "./history.ts";
import { launch } from "./launch.ts";
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
  private models: ModelInfo[] = [];
  private currentModel = "";
  private currentUsed = 0;
  private contextLimit: number | null = null;
  private totalTokens: number | null = null;
  private compactCompleted = false;
  private activeCommand: string | null = null;
  private lastBoundary = "";
  private readonly cwd: string;
  private launcher: typeof launch;
  private readonly createQuery: typeof query;
  constructor(
    cwd: string,
    onInput: InputHandler,
    createQuery = query,
    launcher: typeof launch = launch,
  ) {
    super(onInput);
    this.cwd = cwd;
    this.launcher = launcher;
    this.createQuery = createQuery;
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
    const prompts = async function* (provider: ClaudeProvider): AsyncGenerator<SDKUserMessage> {
      while (!provider.closed && generation === provider.generation) {
        const item = provider.pending.shift();
        if (item) yield item;
        else
          await new Promise<void>((resolve) => {
            provider.wake = resolve;
          });
      }
    };
    const executable = this.launcher === launch ? resolveProfile("claude").command : "claude";
    const options: Options = {
      cwd: this.cwd,
      pathToClaudeCodeExecutable: executable,
      spawnClaudeCodeProcess: ({ args, cwd, env, signal }) => {
        const child = this.launcher("claude", args, cwd ?? this.cwd, env);
        const abort = () => {
          child.kill();
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        child.once("close", () => signal.removeEventListener("abort", abort));
        child.stderr.resume();
        return child;
      },
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      permissionMode: "default",
      hooks: {
        PostCompact: [
          {
            hooks: [
              async (input) => {
                if (!object(input)["agent_id"] && this.compactionId) {
                  this.endCompaction();
                  this.compactCompleted = true;
                }
                return {};
              },
            ],
          },
        ],
      },
      ...(resume ? { resume } : { sessionId: this.threadId }),
      canUseTool: async (name, input) => {
        if (name === "AskUserQuestion") {
          const questions = array(input["questions"]).map((raw, index) => {
            const q = object(raw);
            return {
              id: String(index),
              header: string(q["header"]),
              question: string(q["question"]),
              ...(typeof q["multiSelect"] === "boolean" ? { multiSelect: q["multiSelect"] } : {}),
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
    const session = this.createQuery({ prompt: prompts(this), options });
    this.session = session;
    void (async () => {
      try {
        for await (const message of session) {
          if (generation !== this.generation || this.closed) return;
          this.event(object(message));
        }
        if (generation === this.generation && this.turnId)
          this.finish("Claude Code stopped before completing the turn");
      } catch (error) {
        if (generation === this.generation && !this.closed) {
          if (this.interrupted) this.finish();
          else this.fail(error);
        }
      }
    })();
    const initial = await session.initializationResult();
    this.currentModel = string(object(initial)["model"]);
    this.controls = AgentControlsSchema.parse({
      history: true,
      compact: true,
      contextUsage: true,
      mcp: true,
      modes: [
        { id: "default", label: "Always ask" },
        { id: "plan", label: "Plan", description: "Analyze before making changes" },
        {
          id: "acceptEdits",
          label: "Accept edits",
          description: "Approve edits automatically; other tools still follow Claude permissions",
        },
      ],
      currentMode: "default",
      commands: [
        {
          name: "compact",
          description: "Summarize earlier context",
          argumentHint: "[instructions]",
        },
      ],
    });
    if (session.supportedCommands) {
      const commands = await session.supportedCommands();
      this.controls.commands = [
        { name: "compact", description: "Summarize earlier context", kind: "command" },
        ...commands
          .filter((c) => c.name !== "compact")
          .map((c) => ({
            name: c.name,
            description: c.description,
            argumentHint: c.argumentHint,
            kind: "command" as const,
          })),
      ];
    }
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw),
      session = this.session;
    if (!session) throw new Error("Claude Code is disconnected");
    if (method === "session/controls") return this.controls;
    if (method === "model/list") {
      this.models = await session.supportedModels();
      if (this.models.some((m) => m.supportsAutoMode))
        this.controls.modes = [
          ...this.controls.modes.filter((m) => m.id !== "auto"),
          { id: "auto", label: "Auto review", description: "Claude reviews permission requests" },
        ];
      this.updateModelFeatures();
      return modelCatalog(
        this.models.map((m) => ({
          id: m.value,
          label: m.displayName,
          efforts: m.supportedEffortLevels ?? [],
        })),
      );
    }
    if (method === "collaborationMode/list") return { data: [] };
    if (method === "thread/resume") await this.open(string(p["threadId"]));
    if (method === "thread/start" || method === "thread/resume")
      return {
        thread: {
          id: this.threadId,
          turns:
            method === "thread/resume"
              ? claudeHistory(
                  await getSessionMessages(this.threadId, {
                    dir: this.cwd,
                    includeSystemMessages: true,
                  }),
                )
              : [],
        },
      };
    if (method === "turn/interrupt") {
      this.interrupted = true;
      await session.interrupt();
      this.finish();
      return {};
    }
    if (method !== "turn/start" && method !== "command/execute")
      throw new Error(`Unsupported Claude operation: ${method}`);
    if (method === "command/execute") {
      if (!this.controls.commands.some((c) => c.name === p["name"]))
        throw new Error("Unknown Claude command");
      p["input"] = [
        { type: "text", text: `/${string(p["name"])}${p["args"] ? ` ${string(p["args"])}` : ""}` },
      ];
    }
    await session.setModel(typeof p["model"] === "string" ? p["model"] : undefined);
    if (p["model"]) this.currentModel = string(p["model"]);
    this.updateModelFeatures();
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("Claude Code uses its normal tool approvals in Concors");
    const mode = string(p["nativeMode"]) || "default";
    if (!this.controls.modes.some((m) => m.id === mode))
      throw new Error("Unsupported Claude permission mode");
    await session.setPermissionMode(mode as PermissionMode);
    this.controls.currentMode = mode;
    if (session.applyFlagSettings) {
      const effort = p["effort"];
      if (effort && !["low", "medium", "high", "xhigh", "max"].includes(string(effort)))
        throw new Error("Unsupported Claude thinking effort");
      await session.applyFlagSettings({
        effortLevel: effort ? (effort as "low" | "medium" | "high" | "xhigh" | "max") : null,
      });
      const features = object(p["features"] ?? {});
      const fast = features["fast_mode"];
      if (fast !== undefined) {
        if (fast && !this.controls.features.some((f) => f.id === "fast_mode"))
          throw new Error("Fast mode is not available for this Claude model");
        await session.applyFlagSettings({ fastMode: fast === true });
        const feature = this.controls.features.find((f) => f.id === "fast_mode");
        if (feature) feature.value = fast === true;
      }
    }
    this.controlsChanged();
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
    this.activeCommand = method === "command/execute" ? string(p["name"]) : null;
    this.compactCompleted = false;
    this.tools.clear();
    this.messageId = "";
    this.text = "";
    this.pending.push({
      type: "user",
      uuid: this.turnId as `${string}-${string}-${string}-${string}-${string}`,
      session_id: this.threadId,
      parent_tool_use_id: null,
      message: { role: "user", content },
    });
    this.wake?.();
    return result;
  }
  private event(m: Record<string, unknown>) {
    if (!this.turnId) return;
    const parent = string(m["parent_tool_use_id"]);
    if (parent) {
      // Nested messages belong to their parent tool, not the root assistant reply.
      if (m["type"] === "assistant") {
        const message = object(m["message"]),
          content = array(message["content"]);
        const response = textContent(content.filter((c) => object(c)["type"] === "text"));
        if (response)
          this.item({
            id: `child:${parent}:${string(message["id"])}`,
            type: "subAgentActivity",
            agentPath: this.tools.get(parent)?.name ?? "Agent",
            agentThreadId: parent,
            kind: "working",
            message: response,
          });
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
          const c = object(value),
            id = string(c["tool_use_id"]),
            tool = this.tools.get(id);
          if (c["type"] === "tool_result" && tool)
            this.tool(id, tool.name, tool.input, c["content"], true, c["is_error"] === true);
        }
      return;
    }
    if (m["type"] === "system") {
      if (m["subtype"] === "status" && m["status"] === "compacting") {
        this.compactCompleted = false;
        this.startCompaction();
      }
      if (m["subtype"] === "compact_boundary" && this.lastBoundary !== string(m["uuid"])) {
        this.lastBoundary = string(m["uuid"]);
        if (!this.compactCompleted) {
          this.startCompaction();
          this.endCompaction();
        }
        this.compactCompleted = true;
        const tokens = object(m["compact_metadata"] ?? {})["post_tokens"];
        if (typeof tokens === "number") {
          this.currentUsed = tokens;
          this.usage(tokens, this.contextLimit, this.totalTokens);
        }
      }
      if (m["subtype"] === "local_command_output")
        this.item({
          id: string(m["uuid"]) || randomUUID(),
          type: "agentMessage",
          text: string(m["content"]),
        });
    }
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
      if (message["model"]) this.currentModel = string(message["model"]);
      const usage = object(message["usage"] ?? {});
      if (Object.keys(usage).length) {
        this.currentUsed = [
          "input_tokens",
          "cache_read_input_tokens",
          "cache_creation_input_tokens",
          "output_tokens",
        ].reduce((n, key) => n + (typeof usage[key] === "number" ? usage[key] : 0), 0);
        this.usage(this.currentUsed, this.contextLimit, this.totalTokens);
      }
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
    if (m["type"] === "result") {
      const commandResult = string(m["result"]);
      if (this.activeCommand && commandResult && !this.text)
        this.item({
          id: string(m["uuid"]) || randomUUID(),
          type: "agentMessage",
          text: commandResult,
        });
      if (this.activeCommand === "compact" && !this.compactCompleted) {
        const reason =
          commandResult ||
          array(m["errors"]).map(String).join("\n") ||
          "Claude did not report a compaction result.";
        this.endCompaction(reason);
        this.finish(reason);
        return;
      }

      const modelUsage = object(m["modelUsage"] ?? {});
      const entries: (Record<string, unknown> & { id: string })[] = Object.entries(modelUsage).map(
        ([id, usage]) => ({ id, ...object(usage) }),
      );
      const current =
        entries.find(
          (u) => u.id === this.currentModel || u["canonicalModel"] === this.currentModel,
        ) ?? (entries.length === 1 ? entries[0] : undefined);
      if (current && typeof current["contextWindow"] === "number")
        this.contextLimit = current["contextWindow"];
      if (entries.length)
        this.totalTokens = entries.reduce(
          (n, u) =>
            n +
            [
              "inputTokens",
              "outputTokens",
              "cacheReadInputTokens",
              "cacheCreationInputTokens",
            ].reduce((sum, key) => sum + (typeof u[key] === "number" ? u[key] : 0), 0),
          0,
        );
      if (this.currentUsed) this.usage(this.currentUsed, this.contextLimit, this.totalTokens);
      this.finish(
        m["is_error"] === true
          ? array(m["errors"]).map(String).join("\n") || "Claude Code failed"
          : undefined,
      );
    }
  }
  private updateModelFeatures() {
    const model = this.models.find(
      (m) => m.value === this.currentModel || m.resolvedModel === this.currentModel,
    );
    const previous = this.controls.features.find((f) => f.id === "fast_mode")?.value ?? false;
    this.controls.features = model?.supportsFastMode
      ? [
          {
            id: "fast_mode",
            label: "Fast mode",
            description: "Uses Claude's faster service tier; additional usage may apply",
            value: previous,
          },
        ]
      : [];
  }
  async close() {
    this.closed = true;
    this.generation++;
    this.wake?.();
    this.session?.close();
  }
}
