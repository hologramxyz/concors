import type { AgentPending } from "@concors/protocol";

/** The daemon's lines for what an approval would widen beyond the request itself. */
const GRANT = /^(?:Folder: |Network access:)/;
/** Fields of a tool's input that say what it acts on, after the path a file tool names. */
const TARGETS = ["file_path", "notebook_path", "path", "url", "query", "pattern", "description"];

/**
 * Keep provider payloads in Details. The lead shows the command or the path a person can review,
 * and what approving would widen (a folder, network access) always stays in view below it. It is
 * never blank for a tool's request: at the least it names the tool.
 */
export function approvalSummary(pending: AgentPending): string {
  if (pending.kind !== "approval") return pending.summary;
  const lines = pending.summary.split("\n");
  const grants = lines
    .filter((line) => GRANT.test(line))
    .map((line) => (line.startsWith("Folder: ") ? line.slice(0, 400) : "Requests network access"));
  const [first = "", ...reasons] = lines.filter((line) => !GRANT.test(line));
  // A tool's input can be too long for the summary, which then loses the tool's name after it.
  // The request's details name it first, so it survives there even when they are cut off too.
  const reason = reasons.join("\n") || field(pending.detail, "reason") || "";
  return [lead(first, reason), ...grants].filter(Boolean).join("\n");
}

function lead(first: string, reason: string): string {
  const line = first.trim();
  if (!/^\{\s*"|^\[\s*"/.test(line))
    return [first, reason].filter(Boolean).join("\n").slice(0, 600);
  let input: Record<string, unknown> | null = null;
  try {
    const raw: unknown = JSON.parse(line);
    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string"))
      return raw.join(", ").slice(0, 400);
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      input = raw as Record<string, unknown>;
  } catch {
    // Cut off: what it acts on still leads the input, so read the fields from the text.
  }
  const value = (key: string) =>
    input ? (typeof input[key] === "string" ? input[key] : undefined) : field(line, key);
  const command = value("command");
  if (command) return command.slice(0, 600);
  const tool = reason && !/^(?:\{|\[)/.test(reason.trim()) ? reason.slice(0, 200) : "";
  const target = TARGETS.map(value).find(Boolean);
  return target ? [tool, target].filter(Boolean).join(" · ").slice(0, 600) : tool;
}

/**
 * A string field of JSON text, read without parsing the whole, which may be cut off: a value cut
 * off too is read up to the cut, and marked as continuing.
 */
function field(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)(")?`).exec(text);
  if (!match) return undefined;
  let body = match[1] ?? "";
  // Escapes were read in whole pairs, so a cut can only split a \u escape's four digits.
  const partial = match[2] ? null : /(\\+)u[0-9a-fA-F]{0,3}$/.exec(body);
  if (partial?.[1] && partial[1].length % 2 === 1)
    body = body.slice(0, partial.index + partial[1].length - 1);
  try {
    const value = JSON.parse(`"${body}"`) as string;
    return match[2] ? value : `${value}…`;
  } catch {
    return undefined;
  }
}
