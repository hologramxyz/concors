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

/** A few words from an MCP call's arguments, such as "read, 3f9c…" for Supervisor's tool. */
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

/** The line beside a tool's name: what it ran on, never its own name again. */
export function toolSummary(item: AgentItem): string {
  const { tool, server } = parseToolTitle(item.title);
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
