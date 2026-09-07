import { z } from "zod";
import type { AgentItem } from "@concors/protocol";
import { normalizeCommandExecutionCommand } from "./command-display.ts";

const Item = z
  .object({ id: z.string(), type: z.string(), status: z.string().optional() })
  .passthrough();
const text = (value: unknown) => (typeof value === "string" ? value : "");
const detail = (value: unknown) => (value === undefined ? "" : JSON.stringify(value, null, 2));
/** Adapted to Concors' timeline from Paseo's Codex thread-item mapping. */
export function mapCodexItem(
  raw: unknown,
  completed: boolean,
): Pick<AgentItem, "id" | "kind" | "title" | "text" | "detail" | "status"> | null {
  const item = Item.parse(raw);
  const status: AgentItem["status"] = ["failed", "declined"].includes(item.status ?? "")
    ? "failed"
    : item.status === "interrupted"
      ? "interrupted"
      : completed
        ? "completed"
        : "running";
  const base = { id: item.id, status, detail: "" };
  switch (item.type) {
    case "userMessage":
      return {
        ...base,
        kind: "user",
        title: "You",
        text: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .parse(item["content"])
          .map((c) => c.text ?? "")
          .join("\n"),
      };
    case "agentMessage":
      return { ...base, kind: "assistant", title: "Codex", text: text(item["text"]) };
    case "plan":
      return { ...base, kind: "plan", title: "Plan", text: text(item["text"]) };
    case "reasoning":
      return null; // Only user-facing messages are persisted; raw reasoning stays provider-side.
    case "commandExecution":
      return {
        ...base,
        kind: "tool",
        title: "Run command",
        text: normalizeCommandExecutionCommand(item["command"]) ?? "Command",
        detail: [
          text(item["cwd"]),
          text(item["aggregatedOutput"]),
          item["exitCode"] == null ? "" : `Exit code: ${String(item["exitCode"])}`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "fileChange":
      return {
        ...base,
        kind: "tool",
        title: "Edit files",
        text: "File changes",
        detail: detail(item["changes"]),
      };
    case "mcpToolCall":
      return {
        ...base,
        kind: "tool",
        title: `${text(item["server"])} · ${text(item["tool"])}`,
        text: text(item["tool"]),
        detail: detail({ input: item["arguments"], output: item["result"], error: item["error"] }),
      };
    case "webSearch":
      return {
        ...base,
        kind: "tool",
        title: "Search the web",
        text: text(item["query"]),
        detail: detail(item["action"]),
      };
    case "contextCompaction":
      return {
        ...base,
        kind: "system",
        title: "Context compacted",
        text: "Earlier context was summarized by Codex.",
      };
    default:
      return {
        ...base,
        kind: "tool",
        title: item.type,
        text: text(item["tool"]) || item.type,
        detail: detail(item),
      };
  }
}
