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
  const { lead, grants } = approvalParts(pending);
  return [lead, ...grants].filter(Boolean).join("\n");
}

/**
 * The summary's two parts: what is asked for (the command, the path) and what it would widen.
 * When the lead names a tool and what it acts on, `tool` and `target` hold them apart, so a card
 * can set them side by side without a separator; `path` says the target is a file.
 */
export interface ApprovalParts {
  lead: string;
  grants: string[];
  tool?: string;
  target?: string;
  path?: boolean;
}

export function approvalParts(pending: AgentPending): ApprovalParts {
  if (pending.kind !== "approval") return { lead: pending.summary, grants: [] };
  const lines = pending.summary.split("\n");
  const grants = lines
    .filter((line) => GRANT.test(line))
    .map((line) => (line.startsWith("Folder: ") ? line.slice(0, 400) : "Requests network access"));
  const [first = "", ...reasons] = lines.filter((line) => !GRANT.test(line));
  // A tool's input can be too long for the summary, which then loses the tool's name after it.
  // The request's details name it first, so it survives there even when they are cut off too.
  const reason = reasons.join("\n") || field(pending.detail, "reason") || "";
  return { ...lead(first, reason), grants };
}

/**
 * The first `max` lines of a request's lead, so its answers stay in view under a long script;
 * the whole of it is in the request's details. "…" marks lines left out.
 */
export function leadPreview(lead: string, max = 3): string {
  const lines = lead.split("\n");
  return lines.length > max ? `${lines.slice(0, max).join("\n")} …` : lead;
}

/** Fields that name a file, which a card may write shorter. */
const PATHS = new Set(["file_path", "notebook_path", "path"]);

function lead(
  first: string,
  reason: string,
): { lead: string; tool?: string; target?: string; path?: boolean } {
  const line = first.trim();
  if (!/^\{\s*"|^\[\s*"/.test(line))
    return { lead: [first, reason].filter(Boolean).join("\n").slice(0, 600) };
  let input: Record<string, unknown> | null = null;
  try {
    const raw: unknown = JSON.parse(line);
    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string"))
      return { lead: raw.join(", ").slice(0, 400) };
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      input = raw as Record<string, unknown>;
  } catch {
    // Cut off: what it acts on still leads the input, so read the fields from the text.
  }
  const value = (key: string) =>
    input ? (typeof input[key] === "string" ? input[key] : undefined) : field(line, key);
  const command = value("command");
  if (command) return { lead: command.slice(0, 600) };
  const tool = reason && !/^(?:\{|\[)/.test(reason.trim()) ? reason.slice(0, 200) : "";
  const key = TARGETS.find((name) => value(name));
  const target = key && value(key);
  if (!target) return { lead: tool };
  // The joined form stays for plain-text uses (the Supervisor reads its verb and path from it).
  return {
    lead: [tool, target].filter(Boolean).join(" · ").slice(0, 600),
    ...(tool ? { tool } : {}),
    target: target.slice(0, 600),
    path: PATHS.has(key),
  };
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
