import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  constructor(
    private cwd: string,
    onInput: InputHandler,
  ) {
    super(onInput);
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
        void this.event(e).catch((error) => this.fail(error));
      },
      (error) => {
        if (this.rpc === rpc) this.fail(error);
      },
    );
    this.rpc = rpc;
    await rpc.request("get_state");
  }
  async request(method: string, raw: unknown = {}) {
    const p = object(raw);
    let rpc = this.rpc;
    if (!rpc) throw new Error("Pi is disconnected");
    if (method === "model/list") {
      const data = object(await rpc.request("get_available_models"));
      return modelCatalog(
        array(data["models"]).map((value) => {
          const m = object(value);
          return {
            id: string(m["provider"]) + "/" + string(m["id"]),
            label: string(m["name"]) || string(m["id"]),
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
    if (method !== "turn/start") throw new Error(`Unsupported Pi operation: ${method}`);
    if (object(p["sandboxPolicy"])["type"] === "dangerFullAccess")
      throw new Error("Pi tool calls require approval in Concors");
    const model = string(p["model"]);
    if (model) {
      const slash = model.indexOf("/");
      if (slash < 1) throw new Error("Invalid Pi model");
      await rpc.request("set_model", {
        provider: model.slice(0, slash),
        modelId: model.slice(slash + 1),
      });
    }
    const inputs = array(p["input"]).map(object);
    const images = [];
    for (const item of inputs)
      if (item["type"] === "localImage") {
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
    await rpc.request("prompt", {
      message: inputs
        .filter((i) => i["type"] === "text")
        .map((i) => string(i["text"]))
        .join("\n"),
      ...(images.length ? { images } : {}),
    });
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
    if (e["type"] === "agent_end") this.finish();
  }
  async close() {
    this.closed = true;
    await this.rpc?.close();
  }
}
