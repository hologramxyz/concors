import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import spawn from "cross-spawn";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ContentBlock,
  type SessionConfigOption,
  type SessionNotification,
  type Client,
  type RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import type { ProviderConfig } from "@concors/protocol";
import {
  EventProvider,
  array,
  object,
  string,
  modelCatalog,
  type InputHandler,
} from "./contract.ts";
import type { launch } from "./launch.ts";

const choices = (option: SessionConfigOption) =>
  option.type === "select"
    ? option.options
        .flatMap((o) => ("options" in o ? o.options : [o]))
        .map((o) => ({ id: o.value, label: o.name }))
    : [];

/** Shared ACP transport for Copilot and configured agents. Controls come from the handshake. */
export class AcpProvider extends EventProvider {
  private child: ReturnType<typeof launch> | undefined;
  private connection: ClientSideConnection | undefined;
  private capabilities: AgentCapabilities = {};
  private configOptions: SessionConfigOption[] = [];
  private models: { id: string; label: string }[] = [];
  private currentModel = "";
  private responseId = "";
  private responseText = "";
  private thoughtId = "";
  private thoughtText = "";
  private tools = new Map<string, Record<string, unknown>>();
  private activePrompt: Promise<void> | undefined;
  private loading = false;
  private history: Record<string, unknown>[] = [];
  private terminals = new Map<
    string,
    {
      child: ReturnType<typeof spawn>;
      output: string;
      truncated: boolean;
      exit?: { exitCode?: number; signal?: string } | undefined;
      done: Promise<{ exitCode?: number; signal?: string }>;
    }
  >();
  private cwd: string;
  private config: ProviderConfig;
  private launcher: typeof launch;
  constructor(cwd: string, onInput: InputHandler, config: ProviderConfig, launcher: typeof launch) {
    super(onInput);
    this.cwd = cwd;
    this.config = config;
    this.launcher = launcher;
  }
  async initialize() {
    const child = this.launcher(this.config.id, [], this.cwd);
    this.child = child;
    child.stderr.resume();
    const client: Client = {
      sessionUpdate: async (notification) => this.update(notification),
      requestPermission: (request) => this.approve(request),
      readTextFile: async (p) => {
        this.checkSession(p.sessionId);
        const content = await readFile(resolve(this.cwd, p.path), "utf8");
        if (Buffer.byteLength(content) > 2 * 1024 * 1024)
          throw new Error("File exceeds the 2 MB preview limit");
        const lines = content.split("\n"),
          start = Math.max(0, (p.line ?? 1) - 1);
        return {
          content:
            p.line || p.limit
              ? lines.slice(start, p.limit ? start + p.limit : undefined).join("\n")
              : content,
        };
      },
      writeTextFile: async (p) => {
        this.checkSession(p.sessionId);
        if (Buffer.byteLength(p.content) > 2 * 1024 * 1024) throw new Error("File is too large");
        await writeFile(resolve(this.cwd, p.path), p.content);
        return {};
      },
      createTerminal: async (p) => {
        this.checkSession(p.sessionId);
        if (this.terminals.size >= 16) throw new Error("Too many agent terminals");
        const id = randomUUID(),
          child = spawn(p.command, p.args ?? [], {
            cwd: p.cwd ?? this.cwd,
            env: {
              ...process.env,
              ...this.config.env,
              ...Object.fromEntries(
                (p.env ?? []).map((e: { name: string; value: string }) => [e.name, e.value]),
              ),
            },
            stdio: "pipe",
            windowsHide: true,
          });
        const entry = {
          child,
          output: "",
          truncated: false,
          done: undefined as unknown as Promise<{ exitCode?: number; signal?: string }>,
          exit: undefined as { exitCode?: number; signal?: string } | undefined,
        };
        const limit = Math.min(p.outputByteLimit ?? 64000, 64000);
        const output = (chunk: Buffer) => {
          const bytes = Buffer.from(entry.output + chunk.toString());
          entry.truncated ||= bytes.length > limit;
          entry.output = bytes.subarray(-limit).toString();
        };
        child.stdout?.on("data", output);
        child.stderr?.on("data", output);
        entry.done = new Promise((done) => {
          child.once("close", (code, signal) => {
            entry.exit = {
              ...(code === null ? {} : { exitCode: code }),
              ...(signal ? { signal } : {}),
            };
            done(entry.exit);
          });
          child.once("error", () => {
            entry.exit = { exitCode: 127 };
            done(entry.exit);
          });
        });
        this.terminals.set(id, entry);
        return { terminalId: id };
      },
      terminalOutput: async (p) => {
        const entry = this.terminal(p.sessionId, p.terminalId);
        return {
          output: entry.output,
          truncated: entry.truncated,
          ...(entry.exit ? { exitStatus: entry.exit } : {}),
        };
      },
      waitForTerminalExit: async (p) => this.terminal(p.sessionId, p.terminalId).done,
      killTerminal: async (p) => {
        this.terminal(p.sessionId, p.terminalId).child.kill();
        return {};
      },
      releaseTerminal: async (p) => {
        const entry = this.terminal(p.sessionId, p.terminalId);
        entry.child.kill();
        this.terminals.delete(p.terminalId);
        return {};
      },
      extNotification: async (method, params) => {
        // Kiro publishes commands through its ACP extension instead of the standard update.
        if (this.config.id === "acp-kiro" && method.includes("commands")) {
          this.commands(array(params["commands"] ?? params["availableCommands"]));
        }
      },
    };
    const connection = new ClientSideConnection(
      () => client,
      ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    this.connection = connection;
    child.once("error", (error) => this.fail(error));
    child.once("close", () => {
      if (!this.closed) this.fail(new Error(`${this.config.label} disconnected`));
    });
    const response = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "concors", version: "0.2.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        ...(this.config.id === "acp-cursor" ? { _meta: { parameterizedModelPicker: true } } : {}),
      },
    });
    this.capabilities = response.agentCapabilities ?? {};
    this.controls.history = !!this.capabilities.loadSession;
    this.controls.fork = !!this.capabilities.sessionCapabilities?.fork;
    this.controls.mcp = this.config.params?.supportsMcpServers !== false;
  }
  private checkSession(id: string) {
    if (id !== this.threadId || this.closed || (!this.turnId && !this.loading))
      throw new Error("Agent session is not active");
  }
  private terminal(sessionId: string, id: string) {
    this.checkSession(sessionId);
    const entry = this.terminals.get(id);
    if (!entry) throw new Error("Unknown terminal");
    return entry;
  }
  private async approve(p: RequestPermissionRequest) {
    if (p.sessionId !== this.threadId || !this.turnId || this.interrupted)
      return { outcome: { outcome: "cancelled" as const } };
    const once = p.options.find((o) => o.kind === "allow_once"),
      deny =
        p.options.find((o) => o.kind === "reject_once") ??
        p.options.find((o) => o.kind === "reject_always");
    // Never reinterpret Accept as a permanent grant when an agent only offers allow_always.
    if (!once)
      return deny
        ? { outcome: { outcome: "selected" as const, optionId: deny.optionId } }
        : { outcome: { outcome: "cancelled" as const } };
    try {
      const allowed = await this.permission(
        p.toolCall.title ?? "Allow agent tool?",
        p.toolCall.rawInput ?? p.toolCall.content,
      );
      if (this.interrupted) return { outcome: { outcome: "cancelled" as const } };
      return allowed
        ? { outcome: { outcome: "selected" as const, optionId: once.optionId } }
        : deny
          ? { outcome: { outcome: "selected" as const, optionId: deny.optionId } }
          : { outcome: { outcome: "cancelled" as const } };
    } catch {
      return { outcome: { outcome: "cancelled" as const } };
    }
  }
  private state(raw: unknown) {
    const state = object(raw),
      modes = object(state["modes"] ?? {}),
      models = object(state["models"] ?? {});
    if (modes["availableModes"])
      this.controls.modes = array(modes["availableModes"])
        .map(object)
        .map((m) => ({
          id: string(m["id"]),
          label: string(m["name"]),
          description: string(m["description"]),
        }));
    if (modes["currentModeId"]) this.controls.currentMode = string(modes["currentModeId"]);
    if (models["availableModels"])
      this.models = array(models["availableModels"])
        .map(object)
        .map((m) => ({ id: string(m["modelId"]), label: string(m["name"]) }));
    if (models["currentModelId"]) this.currentModel = string(models["currentModelId"]);
    if (state["configOptions"])
      this.configOptions = state["configOptions"] as SessionConfigOption[];
    for (const c of this.configOptions) {
      if (c.category === "model" && c.type === "select") {
        this.models = choices(c);
        this.currentModel = c.currentValue;
      }
      if (c.category === "mode" && c.type === "select") {
        this.controls.modes = choices(c);
        this.controls.currentMode = c.currentValue;
      }
    }
    this.controls.features = this.configOptions
      .filter((c) => !["model", "mode", "thought_level"].includes(c.category ?? ""))
      .map((c) => ({
        id: c.id,
        label: c.name,
        description: c.description ?? undefined,
        value: c.currentValue,
        ...(c.type === "select" ? { options: choices(c) } : {}),
      }));
    this.controlsChanged();
  }
  private commands(commands: unknown[]) {
    this.controls.commands = commands
      .map(object)
      .filter((c) => c["name"])
      .map((c) => ({
        name: string(c["name"]).replace(/^\//, ""),
        description: string(c["description"]),
        argumentHint: string(object(c["input"] ?? {})["hint"]),
        kind: c["kind"] === "skill" ? "skill" : "command",
      }));
    this.controls.compact = this.controls.commands.some((c) => c.name === "compact");
    this.controlsChanged();
  }
  private update({ sessionId, update }: SessionNotification) {
    if (this.threadId && sessionId !== this.threadId) return;
    if (update.sessionUpdate === "available_commands_update") {
      this.commands(update.availableCommands);
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      this.state({ configOptions: update.configOptions });
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      this.controls.currentMode = update.currentModeId;
      this.controlsChanged();
      return;
    }
    if (!this.turnId && !this.loading) return;
    const emit = (item: Record<string, unknown>, done = true) => {
      if (this.loading) this.history.push(item);
      else this.item(item, done);
    };
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      this.responseId ||= randomUUID();
      this.responseText += update.content.text;
      emit({ id: this.responseId, type: "agentMessage", text: this.responseText }, false);
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      this.thoughtId ||= randomUUID();
      this.thoughtText += update.content.text;
      emit({ id: this.thoughtId, type: "reasoning", text: this.thoughtText }, false);
    }
    if (update.sessionUpdate === "user_message_chunk" && this.loading) {
      this.responseId = "";
      this.responseText = "";
      emit({ id: randomUUID(), type: "userMessage", content: [update.content] });
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      this.responseId = "";
      this.responseText = "";
      const tool = { ...this.tools.get(update.toolCallId), ...object(update) };
      this.tools.set(update.toolCallId, tool);
      const content = array(tool["content"]).map(object),
        done = tool["status"] === "completed" || tool["status"] === "failed";
      const diffs = content.filter((c) => c["type"] === "diff");
      emit(
        {
          id: update.toolCallId,
          type: diffs.length
            ? "fileChange"
            : tool["kind"] === "execute"
              ? "commandExecution"
              : "mcpToolCall",
          tool: string(tool["title"]) || string(tool["kind"]),
          command: string(object(tool["rawInput"] ?? {})["command"]) || string(tool["title"]),
          arguments: tool["rawInput"],
          result: tool["rawOutput"] ?? content,
          ...(diffs.length
            ? {
                changes: diffs.map((d) => ({
                  path: d["path"],
                  diff: `--- before\n${string(d["oldText"])}\n+++ after\n${string(d["newText"])}`,
                })),
              }
            : {}),
          status: done ? tool["status"] : "inProgress",
        },
        done,
      );
    }
    if (update.sessionUpdate === "plan")
      emit({
        id: "plan:" + this.turnId,
        type: "plan",
        text: update.entries.map((e) => `${e.status}: ${e.content}`).join("\n"),
      });
    if (update.sessionUpdate === "usage_update") {
      const usage = object(update);
      if (typeof usage["used"] === "number") {
        this.controls.contextUsage = true;
        this.usage(usage["used"], typeof usage["size"] === "number" ? usage["size"] : null);
      }
    }
  }
  async request(method: string, raw: unknown = {}) {
    const connection = this.connection,
      p = object(raw);
    if (!connection) throw new Error("Agent is disconnected");
    if (method === "session/controls") return this.controls;
    if (method === "collaborationMode/list") return { data: [] };
    if (method === "model/list") {
      const effort = this.configOptions.find((c) => c.category === "thought_level");
      return modelCatalog(
        this.models.map((m) => ({
          ...m,
          efforts: effort ? choices(effort).map((e) => e.id) : [],
          defaultEffort: effort?.type === "select" ? effort.currentValue : null,
          supportsImages: this.capabilities.promptCapabilities?.image === true,
        })),
      );
    }
    if (method === "thread/start" || method === "thread/resume") {
      this.loading = method === "thread/resume";
      this.history = [];
      const args = { cwd: this.cwd, mcpServers: [] };
      try {
        if (this.loading) {
          if (!this.capabilities.loadSession)
            throw new Error(
              `${this.config.label} cannot resume sessions through ACP. Start a new session.`,
            );
          this.threadId = string(p["threadId"]);
          this.state(await connection.loadSession({ ...args, sessionId: this.threadId }));
        } else {
          const response = await connection.newSession(args);
          this.threadId = response.sessionId;
          this.state(response);
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === -32000)
          throw new Error(
            `${this.config.label} requires authentication. Sign in with its CLI on this machine, or add its credentials in Providers settings.`,
            { cause: error },
          );
        throw error;
      } finally {
        this.loading = false;
      }
      return {
        thread: {
          id: this.threadId,
          turns: this.history.length
            ? [{ id: "import:" + this.threadId, status: "completed", items: this.history }]
            : [],
        },
      };
    }
    if (method === "turn/interrupt") {
      this.interrupted = true;
      await connection.cancel({ sessionId: this.threadId });
      await this.activePrompt;
      this.finish();
      return {};
    }
    if (method !== "turn/start" && method !== "command/execute")
      throw new Error(`Unsupported ACP operation: ${method}`);
    if (method === "command/execute") {
      if (!this.controls.commands.some((c) => c.name === p["name"]))
        throw new Error("This agent has not advertised that command");
      p["input"] = [
        { type: "text", text: `/${string(p["name"])}${p["args"] ? ` ${string(p["args"])}` : ""}` },
      ];
    }
    const writeConfig = async (c: SessionConfigOption, value: string | boolean) => {
      this.state(
        await connection.setSessionConfigOption({
          sessionId: this.threadId,
          configId: c.id,
          ...(typeof value === "boolean" ? { type: "boolean", value } : { value }),
        }),
      );
    };
    const model = string(p["model"]);
    if (model && model !== this.currentModel) {
      const option = this.configOptions.find((c) => c.category === "model");
      if (option) await writeConfig(option, model);
      else {
        await connection.unstable_setSessionModel({ sessionId: this.threadId, modelId: model });
        this.currentModel = model;
      }
    }
    const mode = string(p["nativeMode"]);
    if (mode && mode !== this.controls.currentMode) {
      const option = this.configOptions.find((c) => c.category === "mode");
      if (option) await writeConfig(option, mode);
      else {
        await connection.setSessionMode({ sessionId: this.threadId, modeId: mode });
        this.controls.currentMode = mode;
      }
    }
    const effort = this.configOptions.find((c) => c.category === "thought_level");
    if (effort && p["effort"] && p["effort"] !== effort.currentValue)
      await writeConfig(effort, string(p["effort"]));
    for (const [id, value] of Object.entries(object(p["features"] ?? {}))) {
      const c = this.configOptions.find((o) => o.id === id);
      if (c && c.currentValue !== value) await writeConfig(c, value as string | boolean);
    }
    const prompt: ContentBlock[] = [];
    for (const input of array(p["input"]).map(object)) {
      if (input["type"] === "text") prompt.push({ type: "text", text: string(input["text"]) });
      if (input["type"] === "localImage") {
        if (!this.capabilities.promptCapabilities?.image) {
          prompt.push({
            type: "text",
            text: `Image available on this machine at: ${string(input["path"])}`,
          });
          continue;
        }
        const bytes = await readFile(string(input["path"]));
        prompt.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType:
            bytes[0] === 0x89
              ? "image/png"
              : bytes[0] === 0xff
                ? "image/jpeg"
                : bytes[0] === 0x47
                  ? "image/gif"
                  : "image/webp",
        });
      }
    }
    this.responseText = "";
    this.responseId = "";
    this.thoughtId = "";
    this.thoughtText = "";
    this.tools.clear();
    const result = this.begin(),
      turnId = this.turnId;
    this.activePrompt = connection
      .prompt({ sessionId: this.threadId, prompt })
      .then((response) => {
        if (turnId !== this.turnId) return;
        if (response.stopReason === "cancelled") this.interrupted = true;
        if (this.responseId)
          this.item({ id: this.responseId, type: "agentMessage", text: this.responseText });
        if (this.thoughtId)
          this.item({ id: this.thoughtId, type: "reasoning", text: this.thoughtText });
        this.finish();
      })
      .catch((error: Error) => {
        if (turnId === this.turnId) this.finish(error.message);
      });
    return result;
  }
  async close() {
    this.closed = true;
    for (const entry of this.terminals.values()) entry.child.kill();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise<void>((done) => child.once("close", () => done()));
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      await exit;
    } finally {
      clearTimeout(timer);
    }
  }
}
