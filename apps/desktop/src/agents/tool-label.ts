import type { AgentItem } from "@concors/protocol";

/**
 * How a tool call reads in the timeline. CLIs name tools for the model, not for people:
 * Claude Code calls an MCP tool `mcp__concors-supervisor__concors_control` and its own tools
 * `ToolSearch`, and the daemon titles both `<server> · <tool>` with an empty server. This turns
 * those into a short name, and finds something worth reading for the line beside it instead of
 * the tool's name a second time. It does not touch titles that are already words.
 */

/** The tool and the MCP server it belongs to, from a title such as `github · create_issue`. */
export function parseToolTitle(title: string): { tool: string; server: string } {
  const separator = title.indexOf(" · ");
  let server = separator < 0 ? "" : title.slice(0, separator).trim();
  let tool = (separator < 0 ? title : title.slice(separator + 3)).trim();
  // Older daemons left an empty server in front: "· ToolSearch".
  tool = tool.replace(/^·\s*/, "");
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) {
    server ||= mcp[1] ?? "";
    tool = mcp[2] ?? tool;
  }
  return { tool: tool || title.trim(), server };
}

/** `concors_control` → "Concors control", `ToolSearch` → "Tool search"; prose stays as written. */
export function humanizeIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return name;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toolDisplayName(title: string): string {
  return humanizeIdentifier(parseToolTitle(title).tool);
}

const PREFERRED_KEYS = [
  "description",
  "command",
  "file_path",
  "filePath",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
];

function leaves(value: unknown, out: string[]) {
  if (out.length >= 3) return;
  if (typeof value === "string") {
    const line = value.trim().split("\n")[0]?.trim() ?? "";
    if (line && line.length <= 120) out.push(line);
  } else if (typeof value === "number" || typeof value === "boolean") out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) leaves(v, out);
}

/** A few words from an MCP call's arguments, such as "select:Read" for a tool search. */
export function argumentsSummary(input: string | undefined): string {
  if (!input?.trim()) return "";
  let args: unknown;
  try {
    args = JSON.parse(input);
  } catch {
    return input.trim().split("\n")[0] ?? "";
  }
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    for (const key of PREFERRED_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0] ?? "";
    }
  }
  const found: string[] = [];
  leaves(args, found);
  return found.join(", ");
}

/**
 * A command without the `cd <folder> &&` agents put in front of nearly every one: on a row of
 * commands it repeats the same folder, and pushes what actually ran past the end of the line. The
 * full command stays in the expanded row. A bare `cd` is left alone, since then it is the command.
 */
export function commandSummary(command: string): string {
  const trimmed = command.trim();
  const rest = trimmed.replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/, "");
  return rest || trimmed;
}

/** A chat's or workspace's name by its ID, where the client has one (Supervisor's mention list). */
export type NameOf = (id: string) => string | undefined;

const noNames: NameOf = () => undefined;

/** Supervisor's own tool, whose arguments are an operation on chats rather than words to show. */
export function isConcorsControl(item: AgentItem): boolean {
  return item.kind === "tool" && parseToolTitle(item.title).tool === "concors_control";
}

/** The kind of a Concors control call and its operation, or undefined while it cannot be read. */
function controlOperation(input: string | undefined) {
  if (!input?.trim()) return undefined;
  try {
    const args = JSON.parse(input) as { operation?: unknown };
    const operation = args?.operation;
    if (operation && typeof operation === "object" && !Array.isArray(operation)) {
      const record = operation as Record<string, unknown>;
      if (typeof record.kind === "string")
        return record as Record<string, unknown> & { kind: string };
    }
  } catch {
    // Still streaming, or not this tool's shape: no summary rather than raw text.
  }
  return undefined;
}

/**
 * A Concors control call as a step reads: the verb ("Sent instructions to", or "Sending
 * instructions to" while it runs) and the chat or thing it acted on. A chat is named only where
 * the client already knows its name, else "a chat": an ID is never what the line shows. An
 * operation this client does not know reads as its own name in words.
 */
export function controlStep(
  item: AgentItem,
  nameOf: NameOf = noNames,
  live = false,
): { verb: string; target: string } | undefined {
  if (!isConcorsControl(item) || item.presentation?.type !== "mcp") return undefined;
  const op = controlOperation(item.presentation.input);
  if (!op) return undefined;
  const named = (id: unknown, fallback: string) =>
    (typeof id === "string" && nameOf(id)?.trim()) || fallback;
  const chat = (id: unknown) => named(id, "a chat");
  const workspace = (id: unknown) => named(id, "a workspace");
  const step = (past: string, now: string, target: string) => ({
    verb: live ? now : past,
    target,
  });
  switch (op.kind) {
    case "workspaces":
      return step("Listed", "Listing", "workspaces");
    case "layout":
      return step("Read the layout of", "Reading the layout of", workspace(op.projectId));
    case "sessions": {
      const query = typeof op.query === "string" ? op.query.trim().split("\n")[0] : "";
      if (query) return step("Searched chats for", "Searching chats for", query);
      return op.projectId
        ? step("Listed chats in", "Listing chats in", workspace(op.projectId))
        : step("Listed", "Listing", "chats");
    }
    case "read":
      return step("Read", "Reading", chat(op.sessionId));
    case "send":
      return op.whenBusy === "steer"
        ? step("Steered", "Steering", chat(op.sessionId))
        : step("Sent instructions to", "Sending instructions to", chat(op.sessionId));
    case "start": {
      const name = typeof op.name === "string" ? op.name.trim() : "";
      if (name) return step("Started", "Starting", name);
      return op.projectId && nameOf(String(op.projectId))
        ? step("Started a chat in", "Starting a chat in", workspace(op.projectId))
        : step("Started", "Starting", "a chat");
    }
    case "workspace": {
      const command = op.command as { operation?: { projectId?: unknown } } | undefined;
      return step(
        "Changed the tabs of",
        "Changing the tabs of",
        workspace(command?.operation?.projectId),
      );
    }
    case "open-session":
      return step("Opened", "Opening", chat(op.sessionId));
    case "queue-remove":
      return step(
        "Removed a queued instruction from",
        "Removing a queued instruction from",
        chat(op.sessionId),
      );
    case "interrupt":
      return step("Stopped", "Stopping", chat(op.sessionId));
    case "status":
      return step("Checked", "Checking", "delivery status");
    case "capabilities":
      return step("Checked", "Checking", "harnesses and permissions");
    case "watch":
      return op.enabled === false
        ? step("Stopped watching", "Stopping watching", chat(op.sessionId))
        : step("Watching", "Watching", chat(op.sessionId));
    case "wait": {
      const ids = Array.isArray(op.sessionIds) ? op.sessionIds : [];
      return step("Waited on", "Waiting on", ids.length > 1 ? `${ids.length} chats` : chat(ids[0]));
    }
    default:
      return { verb: humanizeIdentifier(op.kind), target: "" };
  }
}

/** The same as one line: "Sent instructions to Sandbox – writer". */
export function controlSummary(item: AgentItem, nameOf?: NameOf, live = false): string | undefined {
  const step = controlStep(item, nameOf, live);
  return step && (step.target ? `${step.verb} ${step.target}` : step.verb);
}

/** The line beside a tool's name: what it ran on, never its own name again. */
export function toolSummary(item: AgentItem, nameOf?: NameOf): string {
  const { tool, server } = parseToolTitle(item.title);
  if (isConcorsControl(item) && item.presentation?.input?.trim())
    // Its arguments are IDs: a summary in words, or none.
    return controlSummary(item, nameOf) ?? "";
  if (item.presentation?.type === "mcp") {
    const args = argumentsSummary(item.presentation.input);
    if (args) return args;
  }
  const text = item.text.trim();
  if (text && parseToolTitle(text).tool !== tool) return text;
  return server ? humanizeIdentifier(server) : "";
}

/**
 * Which calls fold into one row when they follow each other: tools whose separate rows say little
 * on their own (the same MCP tool, file reads, searches). Commands and edits stay one row each,
 * since each command and diff is worth seeing without an extra click.
 */
export function toolGroupKey(item: AgentItem): string | undefined {
  if (item.kind !== "tool") return undefined;
  const type = item.presentation?.type;
  const groupable =
    type === undefined ||
    type === "mcp" ||
    type === "search" ||
    (type === "files" && item.presentation?.fileOperation === "read");
  if (!groupable) return undefined;
  return `${item.turnId}\0${type ?? ""}\0${toolDisplayName(item.title)}`;
}
