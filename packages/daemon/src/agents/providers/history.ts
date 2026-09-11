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

export function claudeHistory(messages: unknown[]): NativeTurn[] {
  const turns: NativeTurn[] = [];
  const tools = new Map<string, { name: string; input: unknown }>();
  let turn: NativeTurn | undefined;
  for (const raw of messages) {
    const entry = object(raw),
      message = object(entry["message"] ?? {}),
      content =
        typeof message["content"] === "string"
          ? [{ type: "text", text: message["content"] }]
          : array(message["content"]).map(object);
    if (entry["parent_tool_use_id"] || entry["isMeta"]) continue;
    if (
      entry["type"] === "user" &&
      typeof message["content"] === "string" &&
      /^<(?:command-name|local-command-(?:stdout|stderr|caveat))>/.test(message["content"].trim())
    )
      continue;
    if (entry["type"] === "user" && !content.some((c) => c["type"] === "tool_result")) {
      turn = {
        id: string(entry["uuid"]),
        status: "completed",
        items: [{ id: `user:${string(entry["uuid"])}`, type: "userMessage", content }],
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
      for (const c of content)
        if (c["type"] === "tool_use") {
          const tool = { name: string(c["name"]), input: c["input"] };
          tools.set(string(c["id"]), tool);
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
              nativeToolItem(id, tool.name, tool.input, c["content"], true, c["is_error"] === true),
            );
        }
  }
  return turns;
}

export function piHistory(messages: unknown[]): NativeTurn[] {
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
      if (message["stopReason"] === "error") turn.status = "failed";
      if (message["stopReason"] === "aborted") turn.status = "interrupted";
      for (const c of content)
        if (c["type"] === "toolCall") {
          const tool = { name: string(c["name"]), input: c["arguments"] };
          tools.set(string(c["id"]), tool);
          turn.items.push(
            nativeToolItem(string(c["id"]), tool.name, tool.input, null, false, false),
          );
        }
    }
    if (message["role"] === "toolResult") {
      const id = string(message["toolCallId"]),
        tool = tools.get(id);
      if (tool)
        turn.items.push(
          nativeToolItem(id, tool.name, tool.input, content, true, message["isError"] === true),
        );
    }
  }
  return turns;
}

export function openCodeHistory(messages: unknown[]): NativeTurn[] {
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
      if (p["type"] === "tool") {
        const state = object(p["state"]);
        turn.items.push(
          nativeToolItem(
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
