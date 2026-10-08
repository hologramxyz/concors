import { TaskState, isTaskTool } from "./plans.ts";
import { array, object, string, textContent } from "./contract.ts";
import { nativeToolItem } from "./tool-items.ts";
export interface NativeTurn {
  id: string;
  status: string;
  items: Record<string, unknown>[];
}
export const messageIdentity = (message: Record<string, unknown>, fallback: string) =>
  string(message["id"]) ||
  (typeof message["timestamp"] === "number" || typeof message["timestamp"] === "string"
    ? `message:${message["timestamp"]}`
    : fallback);

function historyTool(
  tasks: TaskState,
  id: string,
  name: string,
  input: unknown,
  output: unknown,
  done: boolean,
  failed: boolean,
) {
  if (isTaskTool(name) && done) {
    const steps = tasks.update(name, input, output, done, failed);
    if (steps) return { id: `tasks:${id}`, type: "plan", steps, status: "completed" };
  }
  return nativeToolItem(id, name, input, output, done, failed);
}
function thinkingItems(content: Record<string, unknown>[], id: string) {
  return content.flatMap((part, index) =>
    part["type"] === "thinking" && string(part["thinking"])
      ? [{ id: `${id}:thinking:${index}`, type: "reasoning", summary: [string(part["thinking"])] }]
      : [],
  );
}
/**
 * Claude Code splits one API message into an entry per block, so a block's index within an entry
 * says nothing about its place in the message. Number the readable thinking blocks of a message in
 * order instead: the stream sees the same sequence, since signature-only blocks carry no deltas,
 * and a live block then keeps its id when it completes or is replayed.
 */
export function claudeThinkingItems(
  content: Record<string, unknown>[],
  id: string,
  counts: Map<string, number>,
) {
  return content.flatMap((part) => {
    if (part["type"] !== "thinking" || !string(part["thinking"])) return [];
    const ordinal = counts.get(id) ?? 0;
    counts.set(id, ordinal + 1);
    return [
      { id: `${id}:thinking:${ordinal}`, type: "reasoning", summary: [string(part["thinking"])] },
    ];
  });
}

export function claudeHistory(messages: unknown[]): NativeTurn[] {
  const tasks = new TaskState();
  const turns: NativeTurn[] = [];
  const tools = new Map<string, { name: string; input: unknown }>();
  const thinking = new Map<string, number>();
  let turn: NativeTurn | undefined;
  for (const raw of messages) {
    const entry = object(raw),
      message = object(entry["message"] ?? {}),
      content =
        typeof message["content"] === "string"
          ? [{ type: "text", text: message["content"] }]
          : array(message["content"]).map(object);
    // Compaction summaries and interrupt markers are transcript bookkeeping, not prompts.
    if (
      entry["parent_tool_use_id"] ||
      entry["isMeta"] ||
      entry["isCompactSummary"] ||
      entry["isVisibleInTranscriptOnly"]
    )
      continue;
    if (
      entry["type"] === "user" &&
      /^\[Request interrupted by user/.test(
        textContent(content.filter((c) => c["type"] === "text")),
      )
    )
      continue;
    if (
      entry["type"] === "user" &&
      typeof message["content"] === "string" &&
      /^<(?:command-name|local-command-(?:stdout|stderr|caveat))>/.test(message["content"].trim())
    )
      continue;
    if (entry["type"] === "user" && !content.some((c) => c["type"] === "tool_result")) {
      // A background command, monitor or sub-agent reporting back starts a turn of Claude's own,
      // which the live chat shows without a prompt. getSessionMessages drops the transcript's
      // origin field, so the notification is recognised by its text. Claude Code also records one
      // when it resumes a session whose background command was cut off.
      const notification = /^<task-notification>/.test(
        textContent(content.filter((c) => c["type"] === "text")).trim(),
      );
      turn = {
        id: string(entry["uuid"]),
        status: "completed",
        items: notification
          ? []
          : [{ id: `user:${string(entry["uuid"])}`, type: "userMessage", content }],
      };
      turns.push(turn);
    }
    if (!turn) continue;
    if (entry["type"] === "assistant") {
      const text = textContent(content.filter((c) => c["type"] === "text"));
      if (text)
        turn.items.push({
          id: string(message["id"]) || string(entry["uuid"]),
          type: "agentMessage",
          text,
        });
      turn.items.push(
        ...claudeThinkingItems(content, string(message["id"]) || string(entry["uuid"]), thinking),
      );
      for (const c of content)
        if (c["type"] === "tool_use") {
          const tool = { name: string(c["name"]), input: c["input"] };
          tools.set(string(c["id"]), tool);
          if (!isTaskTool(tool.name))
            turn.items.push(
              nativeToolItem(string(c["id"]), tool.name, tool.input, null, false, false),
            );
        }
    }
    if (entry["type"] === "user")
      for (const c of content)
        if (c["type"] === "tool_result") {
          const id = string(c["tool_use_id"]),
            tool = tools.get(id);
          if (tool)
            turn.items.push(
              historyTool(
                tasks,
                id,
                tool.name,
                tool.input,
                { content: c["content"], details: entry["tool_use_result"] },
                true,
                c["is_error"] === true,
              ),
            );
        }
  }
  return turns;
}

export function piHistory(messages: unknown[]): NativeTurn[] {
  const tasks = new TaskState();
  const turns: NativeTurn[] = [],
    tools = new Map<string, { name: string; input: unknown }>();
  let turn: NativeTurn | undefined;
  for (const [index, raw] of messages.entries()) {
    const message = object(raw),
      id = messageIdentity(message, `history:${index}`),
      content =
        typeof message["content"] === "string"
          ? [{ type: "text", text: message["content"] }]
          : array(message["content"]).map(object);
    if (message["role"] === "user") {
      turn = {
        id,
        status: "completed",
        items: [{ id: `user:${id}`, type: "userMessage", content }],
      };
      turns.push(turn);
    }
    if (!turn) continue;
    if (message["role"] === "assistant") {
      const text = textContent(content.filter((c) => c["type"] === "text"));
      if (text) turn.items.push({ id, type: "agentMessage", text });
      turn.items.push(...thinkingItems(content, id));
      if (message["stopReason"] === "error") turn.status = "failed";
      if (message["stopReason"] === "aborted") turn.status = "interrupted";
      for (const c of content)
        if (c["type"] === "toolCall") {
          const tool = { name: string(c["name"]), input: c["arguments"] };
          tools.set(string(c["id"]), tool);
          if (!isTaskTool(tool.name))
            turn.items.push(
              nativeToolItem(string(c["id"]), tool.name, tool.input, null, false, false),
            );
        }
    }
    if (message["role"] === "custom" && message["display"] !== false) {
      const text = textContent(content);
      if (text) turn.items.push({ id, type: "notification", title: "Agent update", text });
    }
    if (message["role"] === "toolResult") {
      const id = string(message["toolCallId"]),
        tool = tools.get(id);
      if (tool)
        turn.items.push(
          historyTool(
            tasks,
            id,
            tool.name,
            tool.input,
            { content, details: message["details"] },
            true,
            message["isError"] === true,
          ),
        );
    }
  }
  return turns;
}

export function openCodeHistory(messages: unknown[]): NativeTurn[] {
  const tasks = new TaskState();
  const turns: NativeTurn[] = [],
    byId = new Map<string, NativeTurn>();
  let turn: NativeTurn | undefined;
  for (const raw of messages) {
    const message = object(raw),
      info = object(message["info"]),
      parts = array(message["parts"]).map(object);
    if (info["role"] === "user") {
      turn = {
        id: string(info["id"]),
        status: "completed",
        items: [
          {
            id: `user:${string(info["id"])}`,
            type: "userMessage",
            content: parts.filter((p) => p["type"] === "text"),
          },
        ],
      };
      turns.push(turn);
      byId.set(turn.id, turn);
    } else turn = byId.get(string(info["parentID"])) ?? turn;
    if (!turn || info["role"] !== "assistant") continue;
    if (info["summary"] || info["agent"] === "compaction" || info["mode"] === "compaction")
      continue;
    if (info["error"]) turn.status = "failed";
    for (const p of parts) {
      if (p["type"] === "text")
        turn.items.push({ id: string(p["id"]), type: "agentMessage", text: string(p["text"]) });
      if (p["type"] === "reasoning")
        turn.items.push({ id: string(p["id"]), type: "reasoning", summary: [string(p["text"])] });
      if (p["type"] === "tool") {
        const state = object(p["state"]);
        turn.items.push(
          historyTool(
            tasks,
            string(p["id"]),
            string(p["tool"]),
            state["input"],
            { content: state["output"] ?? state["error"], details: state["metadata"] },
            state["status"] === "completed" || state["status"] === "error",
            state["status"] === "error",
          ),
        );
      }
    }
  }
  return turns;
}
