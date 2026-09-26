import { planSteps } from "../providers/plans.ts";
import { z } from "zod";
import { AgentActivityStepSchema, SUB_AGENT_STEPS, type AgentItem } from "@concors/protocol";
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
): Pick<AgentItem, "id" | "kind" | "title" | "text" | "detail" | "status" | "presentation"> | null {
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
      if (item["delivery"] === "async" && Array.isArray(item["questions"]))
        return {
          ...base,
          kind: "system",
          title: "Agent questions",
          text: item["questions"]
            .map((q) =>
              typeof q === "object" && q ? text((q as Record<string, unknown>)["title"]) : "",
            )
            .filter(Boolean)
            .join("\n"),
        };
      return { ...base, kind: "assistant", title: "Codex", text: text(item["text"]) };
    case "plan":
      return {
        ...base,
        kind: "plan",
        title: "Plan",
        text: text(item["text"]),
        ...(Array.isArray(item["steps"])
          ? { presentation: { type: "plan", steps: planSteps(item["steps"]) } }
          : {}),
      };
    case "reasoning":
      return {
        ...base,
        kind: "tool",
        title: "Thinking",
        text: z.array(z.string()).catch([]).parse(item["summary"]).join("\n\n"),
        presentation: { type: "thinking" },
      }; // Provider-authored summaries only; never raw reasoning content.
    case "commandExecution":
      return {
        ...base,
        kind: "tool",
        title: "Run command",
        presentation: {
          type: "shell",
          command: (normalizeCommandExecutionCommand(item["command"]) ?? "Command").slice(0, 16000),
          cwd: text(item["cwd"]),
          exitCode: typeof item["exitCode"] === "number" ? item["exitCode"] : null,
        },
        text: normalizeCommandExecutionCommand(item["command"]) ?? "Command",
        detail: [
          text(item["cwd"]),
          text(item["aggregatedOutput"]),
          item["exitCode"] == null ? "" : `Exit code: ${String(item["exitCode"])}`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "fileRead":
      return {
        ...base,
        kind: "tool",
        title: "Read file",
        text: text(item["path"]),
        detail: text(item["output"]),
        presentation: {
          type: "files",
          fileOperation: "read",
          files: text(item["path"]) ? [{ path: text(item["path"]), diff: "" }] : [],
        },
      };
    case "search":
      return {
        ...base,
        kind: "tool",
        title: text(item["tool"]) || "Search",
        text: text(item["query"]),
        detail: text(item["output"]),
        presentation: { type: "search" },
      };
    case "fileChange":
      return {
        ...base,
        kind: "tool",
        title: "Edit files",
        presentation: {
          type: "files",
          fileOperation: "edit",
          files: z
            .array(z.object({ path: z.string(), diff: z.string().optional() }))
            .catch([])
            .parse(item["changes"])
            .slice(0, 100)
            .map((f) => ({ path: f.path, diff: (f.diff ?? "").slice(0, 16000) })),
        },
        text: "File changes",
        detail: detail({
          changes: item["changes"],
          input: item["nativeInput"],
          output: item["nativeOutput"],
        }),
      };
    case "collabAgentToolCall": {
      const states = z
        .record(
          z.string(),
          z.object({ status: z.string(), message: z.string().nullable().optional() }),
        )
        .catch({})
        .parse(item["agentsStates"]);
      const ids = z.array(z.string()).catch([]).parse(item["receiverThreadIds"]);
      const activity = (Array.isArray(item["activity"]) ? item["activity"] : [])
        .flatMap((step) => {
          const parsed = AgentActivityStepSchema.safeParse(step);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(-SUB_AGENT_STEPS);
      return {
        ...base,
        kind: "tool",
        title: "Sub-agents",
        text: text(item["prompt"]) || text(item["tool"]),
        detail: detail(item),
        presentation: {
          type: "sub_agent",
          children: ids.slice(0, 100).map((id) => ({
            id,
            status: states[id]?.status ?? "running",
            message: states[id]?.message?.slice(0, 4000) ?? null,
          })),
          ...(text(item["agentType"]) ? { agentType: text(item["agentType"]).slice(0, 100) } : {}),
          ...(activity.length ? { activity } : {}),
        },
      };
    }
    case "subAgentActivity":
      return {
        ...base,
        kind: "tool",
        title: "Sub-agent activity",
        text: text(item["agentPath"]),
        detail: detail(item),
        presentation: {
          type: "sub_agent",
          children: [
            {
              id: text(item["agentThreadId"]),
              status: text(item["kind"]),
              message: text(item["message"]).slice(0, 4000) || null,
            },
          ],
        },
      };
    case "mcpToolCall":
      return {
        ...base,
        kind: "tool",
        title: `${text(item["server"])} · ${text(item["tool"])}`,
        presentation: {
          type: "mcp",
          input: detail(item["arguments"]).slice(0, 16000),
          output: detail(item["result"] ?? item["error"]).slice(0, 16000),
        },
        text: text(item["tool"]),
        detail: detail({ input: item["arguments"], output: item["result"], error: item["error"] }),
      };
    case "webSearch":
      return {
        ...base,
        kind: "tool",
        title: "Search the web",
        presentation: { type: "search" },
        text: text(item["query"]),
        detail: detail(item["action"]),
      };
    case "notification":
      return {
        ...base,
        kind: "system",
        title: text(item["title"]) || "Agent update",
        text: text(item["text"]),
      };
    case "contextCompaction":
      return {
        ...base,
        kind: "system",
        title:
          status === "running"
            ? "Compacting context"
            : status === "completed"
              ? "Context compacted"
              : "Compaction interrupted or failed",
        text:
          text(item["message"]) ||
          (status === "running"
            ? "Summarizing earlier context…"
            : status === "completed"
              ? "Earlier context was summarized."
              : "The context could not be compacted."),
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
