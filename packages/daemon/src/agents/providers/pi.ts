import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentControlsSchema } from "@concors/protocol";
import {
  EventProvider,
  array,
  object,
  string,
  textContent,
  modelCatalog,
  type InputHandler,
} from "./contract.ts";
import { launch } from "./launch.ts";
import { JsonLines } from "./json-lines.ts";
// Pi's tool_call hook waits for the native RPC confirmation dialog before each tool executes.
// This extension is supplied explicitly on every launch, including resumed sessions.
const guard = `export default function(pi) { pi.on("tool_call", async (event,ctx) => {
  const allowed = await ctx.ui.confirm("Allow " + event.toolName + "?", JSON.stringify(event));
  if (!allowed) return {block:true,reason:"Declined in Concors"};
}); }`;
export class PiProvider extends EventProvider {
  private rpc: JsonLines | undefined;
  private directory = join(
    process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors"),
    "pi-sessions",
  );
  private text = "";
  private messageId = "";
  private cwd: string;
  private models = new Map<string, Record<string, unknown>>();
  private model: Record<string, unknown> = {};
  private thinkingLevel = "off";
  constructor(cwd: string, onInput: InputHandler) {
    super(onInput);
    this.cwd = cwd;
  }
  async initialize() {
    await this.open();
  }
  private async open(file?: string) {
    const prior = this.rpc;
    this.rpc = undefined;
    await prior?.close();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const extension = join(this.directory, "concors-approvals.mjs");
    await writeFile(extension, guard, { mode: 0o600 });
    const rpc = new JsonLines(
      launch(
        "pi",
        [
          "--mode",
          "rpc",
          "--extension",
          extension,
          ...(file ? ["--session", file] : ["--no-session"]),
        ],
        this.cwd,
      ),
      (e) => {
        void this.event(e).catch((error) => {
          if (this.rpc === rpc && !this.interrupted) this.fail(error);
        });
      },
      (error) => {
        if (this.rpc === rpc) this.fail(error);
      },
    );
    this.rpc = rpc;
    const state = object(await rpc.request("get_state"));
    this.model = object(state["model"] ?? {});
    this.thinkingLevel = string(state["thinkingLevel"]) || "off";
    this.controls = AgentControlsSchema.parse({
      compact: true,
      contextUsage: true,
      commands: [
        {
          name: "compact",
          description: "Summarize earlier context",
          argumentHint: "[instructions]",
        },
        {
          name: "autocompact",
          description: "Configure automatic compaction",
          argumentHint: "[on|off|toggle]",
        },
      ],
      features: [
        {
          id: "auto_compaction",
          label: "Automatic compaction",
          value: state["autoCompactionEnabled"] !== false,
        },
      ],
    });
    try {
      const commands = object(await rpc.request("get_commands"));
      for (const raw of array(commands["commands"])) {
        const command = object(raw),
          name = string(command["name"]);
        if (name && !this.controls.commands.some((c) => c.name === name))
          this.controls.commands.push({
            name,
            description: string(command["description"]),
            kind: command["source"] === "skill" ? "skill" : "command",
            argumentHint: string(object(command["input"] ?? {})["hint"]),
          });
      }
    } catch {
      /* Older Pi versions do not expose extension commands. */
    }
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw);
    let rpc = this.rpc;
    if (!rpc) throw new Error("Pi is disconnected");
    if (method === "session/controls") return this.controls;
    if (method === "model/list") {
      const data = object(await rpc.request("get_available_models"));
      return modelCatalog(
        array(data["models"]).map((value) => {
          const m = object(value);
          this.models.set(string(m["provider"]) + "/" + string(m["id"]), m);
          return {
            id: string(m["provider"]) + "/" + string(m["id"]),
            label: string(m["name"]) || string(m["id"]),
            efforts: m["reasoning"]
              ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
              : [],
            supportsImages: array(m["input"]).includes("image"),
            ...(typeof m["contextWindow"] === "number" && m["contextWindow"] > 0
              ? { contextWindow: m["contextWindow"] }
              : {}),
          };
        }),
      );
    }
    if (method === "collaborationMode/list") return { data: [] };
    if (method === "thread/start" || method === "thread/resume") {
      this.threadId =
        method === "thread/resume"
          ? string(p["threadId"])
          : join(this.directory, randomUUID() + ".jsonl");
      await this.open(this.threadId);
      return { thread: { id: this.threadId, turns: [] } };
    }
    if (method === "turn/interrupt") {
      this.interrupted = true;
      await rpc.request("abort");
      this.finish();
      return {};
    }
    if (method === "command/execute") {
      const name = string(p["name"]),
        args = string(p["args"]);
      if (!this.controls.commands.some((c) => c.name === name))
        throw new Error("Unknown Pi command");
      if (name === "compact" || name === "autocompact") {
        if (name === "autocompact" && !["", "on", "off", "toggle"].includes(args))
          throw new Error("Use /autocompact [on|off|toggle]");
        const result = this.begin(),
          turnId = this.turnId;
        if (name === "compact") this.startCompaction();
        const auto = this.controls.features.find((f) => f.id === "auto_compaction");
        const enabled = args === "on" || (args !== "off" && auto?.value !== true);
        void rpc
          .request(
            name === "compact" ? "compact" : "set_auto_compaction",
            name === "compact" ? (args ? { customInstructions: args } : {}) : { enabled },
            300000,
          )
          .then(async () => {
            if (turnId !== this.turnId) return;
            if (name === "compact") this.endCompaction();
            else {
              if (auto) auto.value = enabled;
              this.controlsChanged();
              this.item({
                id: randomUUID(),
                type: "agentMessage",
                text: `Automatic compaction ${enabled ? "enabled" : "disabled"}.`,
              });
            }
            await this.refreshUsage();
            if (turnId === this.turnId) this.finish();
          })
          .catch((error: Error) => {
            if (turnId === this.turnId) {
              this.endCompaction(error.message);
              this.finish(error.message);
            }
          });
        return result;
      }
      p["input"] = [{ type: "text", text: `/${name}${args ? ` ${args}` : ""}` }];
    } else if (method !== "turn/start") throw new Error(`Unsupported Pi operation: ${method}`);
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("Pi tool calls require approval in Concors");
    const model = string(p["model"]);
    if (model) {
      const slash = model.indexOf("/");
      if (slash < 1) throw new Error("Invalid Pi model");
      const selected = object(
        await rpc.request("set_model", {
          provider: model.slice(0, slash),
          modelId: model.slice(slash + 1),
        }),
      );
      this.model = selected["id"] ? selected : (this.models.get(model) ?? {});
    }
    const effort = string(p["effort"]);
    if (effort && effort !== this.thinkingLevel) {
      await rpc.request("set_thinking_level", { level: effort });
      this.thinkingLevel = effort;
    }
    const features = object(p["features"] ?? {});
    const auto = this.controls.features.find((f) => f.id === "auto_compaction");
    if (
      typeof features["auto_compaction"] === "boolean" &&
      features["auto_compaction"] !== auto?.value
    ) {
      await rpc.request("set_auto_compaction", { enabled: features["auto_compaction"] });
      if (auto) auto.value = features["auto_compaction"];
      this.controlsChanged();
    }
    const inputs = array(p["input"]).map(object);
    const images = [];
    for (const item of inputs)
      if (item["type"] === "localImage") {
        if (!array(this.model["input"]).includes("image")) {
          inputs.push({
            type: "text",
            text: `Image available on this machine at: ${string(item["path"])}`,
          });
          continue;
        }
        const bytes = await readFile(string(item["path"]));
        images.push({
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
    const result = this.begin();
    this.text = "";
    this.messageId = randomUUID();
    rpc = this.rpc;
    if (!rpc) throw new Error("Pi is disconnected");
    const ack = object(
      (await rpc.request("prompt", {
        message: inputs
          .filter((i) => i["type"] === "text")
          .map((i) => string(i["text"]))
          .join("\n"),
        ...(images.length ? { images } : {}),
      })) ?? {},
    );
    if (ack["agentInvoked"] === false) this.finish();
    return result;
  }
  private async event(e: Record<string, unknown>) {
    if (e["type"] === "extension_ui_request") {
      const id = e["id"];
      if (!this.turnId) {
        this.rpc?.write({ type: "extension_ui_response", id, cancelled: true, confirmed: false });
        return;
      }
      if (e["method"] === "confirm") {
        const confirmed = await this.permission(string(e["title"]), e["message"]);
        this.rpc?.write({ type: "extension_ui_response", id, confirmed });
        return;
      }
      if (e["method"] === "select" || e["method"] === "input") {
        const options =
          e["method"] === "select"
            ? array(e["options"]).map((label) => ({ label: String(label), description: "" }))
            : null;
        const response = object(
          await this.onInput(
            "item/tool/requestUserInput",
            {
              threadId: this.threadId,
              turnId: this.turnId,
              questions: [{ id: "value", header: "Pi", question: string(e["title"]), options }],
            },
            String(id),
          ),
        );
        const answer = object(object(response["answers"])["value"]);
        this.rpc?.write({ type: "extension_ui_response", id, value: array(answer["answers"])[0] });
        return;
      }
      this.rpc?.write({ type: "extension_ui_response", id, cancelled: true });
      return;
    }
    if (!this.turnId) return;
    if (e["type"] === "command_output")
      this.item({ id: randomUUID(), type: "agentMessage", text: string(e["text"]) });
    if (["compaction_start", "auto_compaction_start"].includes(string(e["type"])))
      this.startCompaction();
    if (["compaction_end", "auto_compaction_end"].includes(string(e["type"])))
      this.endCompaction(string(e["errorMessage"]) || (e["aborted"] ? "Interrupted" : undefined));
    if (e["type"] === "message_start") {
      this.messageId = randomUUID();
      this.text = "";
    }
    if (e["type"] === "message_update") {
      const event = object(e["assistantMessageEvent"]);
      if (event["type"] === "text_delta") {
        this.text += string(event["delta"]);
        this.item({ id: this.messageId, type: "agentMessage", text: this.text }, false);
      }
    }
    if (e["type"] === "message_end") {
      const m = object(e["message"]);
      if (m["role"] === "assistant") {
        const text = textContent(array(m["content"]).filter((v) => object(v)["type"] === "text"));
        if (text) this.item({ id: this.messageId, type: "agentMessage", text });
        if (m["errorMessage"]) this.finish(string(m["errorMessage"]));
      }
    }
    if (string(e["type"]).startsWith("tool_execution_"))
      this.tool(
        string(e["toolCallId"]),
        string(e["toolName"]),
        e["args"],
        e["result"] ?? e["partialResult"],
        e["type"] === "tool_execution_end",
        e["isError"] === true,
      );
    if (e["type"] === "agent_end" || e["type"] === "agent_settled") {
      const turnId = this.turnId;
      await this.refreshUsage();
      if (turnId === this.turnId) this.finish();
    }
  }
  private async refreshUsage() {
    const rpc = this.rpc;
    if (!rpc || this.closed) return;
    try {
      const stats = object(await rpc.request("get_session_stats"));
      const state = stats["contextUsage"] ? stats : object(await rpc.request("get_state"));
      const context = object(state["contextUsage"] ?? {}),
        tokens = object(stats["tokens"] ?? {});
      if (typeof context["tokens"] === "number")
        this.usage(
          context["tokens"],
          typeof context["contextWindow"] === "number" ? context["contextWindow"] : null,
          typeof tokens["total"] === "number" ? tokens["total"] : null,
        );
    } catch {
      /* Usage is optional; a statistics failure must not lose a finished reply. */
    }
  }
  async close() {
    this.closed = true;
    await this.rpc?.close();
  }
}
