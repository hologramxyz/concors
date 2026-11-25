import type { AgentItem, AgentPending } from "@concors/protocol";
import { approvalParts, field } from "./approval-summary";

/**
 * What an approval's details show, read from the request the agent sent rather than printed as
 * it: a person reviews the file it would write, the change it would make or the command it would
 * run, never the request's IDs or its escaped JSON. The card and the Supervisor's row draw the
 * same thing from this.
 *
 * - `write`: a new file's whole content, drawn as the chat draws a created file.
 * - `edit`: the change to each file, drawn as the chat draws an edit.
 * - `command`: the command in full, with where it runs, how long it may take and what it reaches
 *   when the request says. Where the card or row shows the whole command, only those facts.
 * - `input`: anything else, as the chat shows a tool's input: its own arguments, IDs left out.
 *
 * `repeats` says the card's line can hold all of the request's main text (a one-line command, a
 * search's query), so that text is worth showing again only where the line had to cut it short
 * (see `reviewView`). `description` is what Claude Code says a command is for, which the card
 * shows above it.
 */
export type ApprovalView =
  | { kind: "write"; path: string; diff: string }
  | { kind: "edit"; files: { path: string; diff: string }[] }
  | { kind: "command"; command?: string; folder?: string; timeout?: string; network?: string }
  | { kind: "input"; text: string };

export interface ApprovalDetails {
  view: ApprovalView;
  repeats: boolean;
  description?: string;
}

/**
 * What the details show beside a card or row that already shows `whole` of the request's main
 * text, or null when they would add nothing: a command it shows whole leaves only where it runs,
 * how long it may take and what it reaches; anything else it shows whole leaves nothing.
 */
export function reviewView(details: ApprovalDetails | null, whole: boolean): ApprovalView | null {
  if (!details) return null;
  const { view } = details;
  if (view.kind === "command") {
    if (!whole) return view;
    const { folder, timeout, network } = view;
    if (!folder && !timeout && !network) return null;
    return {
      kind: "command",
      ...(folder ? { folder } : {}),
      ...(timeout ? { timeout } : {}),
      ...(network ? { network } : {}),
    };
  }
  return whole && details.repeats ? null : view;
}

type Fields = Record<string, unknown>;

const record = (value: unknown): Fields | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : null;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Fields of a request that are for the agent and Concors, never for the person reviewing it. */
const INTERNAL = new Set([
  "threadId",
  "turnId",
  "itemId",
  "approvalId",
  "callId",
  "sessionId",
  "availableDecisions",
  "actions",
  "decisionLabels",
  "approvalKind",
]);
/** What the card's header already shows of any request: why, and what it would widen. */
const ON_CARD = new Set(["reason", "grantRoot", "networkApprovalContext"]);

/**
 * The same for a row that opens its action in place, as the Supervisor chat's pending block does:
 * a command it quotes in full is shown there, so the details add only its facts; anything else
 * it quotes is shown there too.
 */
export function rowReviewView(
  details: ApprovalDetails | null,
  quoted: string,
): ApprovalView | null {
  const command = details?.view.kind === "command" ? details.view.command?.trim() : undefined;
  return reviewView(details, command ? quoted.trim().startsWith(command) : true);
}

/**
 * The request as the agent sent it. Its details are cut at 16,000 characters, so a large file's
 * content can leave them unparseable; what leads them is then read field by field, up to the cut.
 */
function request(pending: AgentPending): Fields | null {
  try {
    return record(JSON.parse(pending.detail));
  } catch {
    const command = field(pending.detail, "command");
    const fields: Fields = {};
    for (const key of ["itemId", "cwd", "reason"]) {
      const value = field(pending.detail, key);
      if (value !== undefined) fields[key] = value;
    }
    return command === undefined
      ? Object.keys(fields).length
        ? fields
        : null
      : { ...fields, command };
  }
}

/** The timeline item a Codex file change's request is about, whose diff the request leaves out. */
export function approvalItemId(pending: AgentPending): string | undefined {
  if (pending.kind !== "approval") return undefined;
  return text(request(pending)?.["itemId"]);
}

export function approvalDetails(pending: AgentPending, item?: AgentItem): ApprovalDetails | null {
  // A plan is shown whole on the card itself.
  if (pending.kind !== "approval" || pending.plan !== undefined || pending.approvalKind === "plan")
    return null;
  const params = request(pending);
  // Details too cut off to read would show only the request's IDs.
  if (!params) return null;
  const { lead, target } = approvalParts(pending);
  const network = text(record(params["networkApprovalContext"])?.["host"]);
  const raw = params["command"];
  if (Array.isArray(raw))
    return command(shellCommand(raw), text(params["cwd"]), undefined, network, lead);
  if (typeof raw === "string") {
    const input = toolInput(raw);
    if (input === undefined)
      return command(shellCommand(raw), text(params["cwd"]), undefined, network, lead);
    return tool(input, raw, lead, target);
  }
  // Codex asks about a file change by naming the item that holds it.
  const files =
    item?.presentation?.type === "files" && item.presentation.fileOperation !== "read"
      ? (item.presentation.files ?? []).filter((file) => file.diff)
      : [];
  if (item && item.id === text(params["itemId"]) && files.length)
    return { view: { kind: "edit", files }, repeats: false };
  const rest = Object.fromEntries(
    Object.entries(params).filter(([key]) => !INTERNAL.has(key) && !ON_CARD.has(key)),
  );
  return Object.keys(rest).length
    ? { view: { kind: "input", text: JSON.stringify(rest, null, 2) }, repeats: false }
    : null;
}

/**
 * A tool's input, which Claude Code and agents spoken to the same way send as the request's
 * command; undefined when the command is a shell command.
 */
function toolInput(raw: string): unknown {
  if (!/^\s*[[{"]/.test(raw)) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Cut off with the request: what it acts on still leads it.
    if (!/^\s*\{/.test(raw)) return undefined;
    const fields: Fields = {};
    for (const key of [
      "file_path",
      "filePath",
      "path",
      "content",
      "old_string",
      "new_string",
      "command",
    ]) {
      const value = field(raw, key);
      if (value !== undefined) fields[key] = value;
    }
    return Object.keys(fields).length ? fields : { input: raw };
  }
}

function tool(input: unknown, raw: string, lead: string, target?: string): ApprovalDetails {
  // OpenCode asks about patterns, which the card lists in full already.
  if (Array.isArray(input))
    return {
      view: { kind: "input", text: input.map((entry) => String(entry)).join("\n") },
      repeats: true,
    };
  const args = record(input);
  if (!args)
    return {
      view: { kind: "input", text: typeof input === "string" ? input : raw },
      repeats: false,
    };
  const path = text(args["file_path"] ?? args["filePath"] ?? args["path"]);
  const content = text(args["content"]);
  if (path && content !== undefined)
    return { view: { kind: "write", path, diff: added(content) }, repeats: false };
  const edits = Array.isArray(args["edits"]) ? args["edits"].map(record) : [args];
  const diff = edits
    .map((edit) => (edit ? replaced(edit) : ""))
    .filter(Boolean)
    .join("\n");
  if (path && diff) return { view: { kind: "edit", files: [{ path, diff }] }, repeats: false };
  const shell = text(args["command"] ?? args["cmd"]);
  if (shell) {
    const timeout = typeof args["timeout"] === "number" ? waitWords(args["timeout"]) : undefined;
    const description = text(args["description"])?.trim();
    return {
      ...command(shell, text(args["cwd"] ?? args["workdir"]), timeout, undefined, lead),
      ...(description ? { description } : {}),
    };
  }
  // Anything else reads as the chat reads a tool's input; one field the card names says nothing new.
  const values = Object.values(args).filter((value) => value !== undefined && value !== null);
  return {
    view: { kind: "input", text: JSON.stringify(args, null, 2) },
    repeats: values.length === 1 && values[0] === target,
  };
}

function command(
  full: string,
  folder: string | undefined,
  timeout: string | undefined,
  network: string | undefined,
  lead: string,
): ApprovalDetails {
  const shown = lead.trim();
  // The card shows its lead in up to three lines and 600 characters.
  const whole =
    shown.length < 600 && shown.split("\n").length <= 3 && shown.startsWith(full.trim());
  return {
    view: {
      kind: "command",
      command: full,
      ...(folder ? { folder } : {}),
      ...(timeout ? { timeout } : {}),
      ...(network ? { network } : {}),
    },
    repeats: whole,
  };
}

/** A file's new content in the lines a created file's diff shows: each one added. */
function added(content: string): string {
  return content
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
}

/** One replacement in an edit, the text it takes out and the text it puts in. */
function replaced(edit: Fields): string {
  const before = text(edit["old_string"] ?? edit["oldText"] ?? edit["old_text"]);
  const after = text(edit["new_string"] ?? edit["newText"] ?? edit["new_text"]);
  if (before === undefined || after === undefined) return "";
  const lines = (value: string, mark: string) =>
    value ? value.split("\n").map((line) => mark + line) : [];
  return [...lines(before, "-"), ...lines(after, "+")].join("\n");
}

/**
 * A command as the person would type it: the shell an agent wraps it in (`bash -lc '…'`, or
 * PowerShell's `-Command`) is left out, as the card's lead leaves it out.
 */
export function shellCommand(value: string | readonly unknown[]): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const unix = /^(?:(?:\/[^/\s]+)*\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+([\s\S]+)$/.exec(trimmed);
    const windows =
      /^(?:"[^"]*\\)?(?:pwsh|powershell|cmd)(?:\.exe)?"?(?:\s+-[A-Za-z]+(?:\s+[^-\s][^\s]*)?)*\s+(?:-Command|-c|\/c)\s+([\s\S]+)$/i.exec(
        trimmed,
      );
    const inner = (unix?.[1] ?? windows?.[1])?.trim();
    return inner ? unquote(inner) : trimmed;
  }
  const parts = value
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3 && /^(?:-lc|-c)$/.test(parts[1] ?? "")) return parts[2] ?? "";
  if (
    parts.length >= 3 &&
    /(?:^|\\)(?:pwsh|powershell|cmd)(?:\.exe)?$/i.test(
      (parts[0] ?? "").replace(/^["']|["']$/g, ""),
    ) &&
    /^(?:-command|-c|\/c)$/i.test(parts[1] ?? "")
  )
    return unquote(parts.slice(2).join(" "));
  return parts.join(" ");
}

function unquote(value: string) {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}

/** How long a command may run, from the milliseconds Claude Code's shell tool takes. */
export function waitWords(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `Times out after ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.round(seconds / 60);
  if (seconds % 60 === 0 || minutes >= 10)
    return `Times out after ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `Times out after ${(seconds / 60).toFixed(1)} minutes`;
}
