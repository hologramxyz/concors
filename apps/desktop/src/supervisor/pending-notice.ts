import type { AgentItem } from "@concors/protocol";

/**
 * Supervisor's note that a chat it watches is waiting on a request: the daemon writes one sentence
 * naming the chat and whether it needs an approval or an answer, the request's action as a quote,
 * and a line saying where to answer it (with how many instructions are queued behind it, if any).
 * The chat draws it as one block. It is read by its title, its ID and the daemon's fixed wording,
 * and anything not in that shape is drawn as the daemon wrote it. Once the request is answered the
 * daemon rewrites the same item into the answered notice (`answeredNotice`).
 */
export const PENDING_TITLE = "Agent needs your input";

/** `supervisor-watch:<supervisor>:<session>:input:<turn>:<request>`, as the daemon names it. */
const NOTICE_ID = /^supervisor-watch:[^:]+:([^:]+):input:.+:([^:]+)$/;

/** A file request as the daemon names it: its tool, then the file's name ("Write haiku.txt"). */
const FILE_ACTION = /^(Write|Edit|MultiEdit|NotebookEdit|Read|File operation) ([^\n/\\]+)$/;

/** The daemon's last line: a tool's approval is answerable here, anything else in its chat. */
const ANSWER_HERE = "Answer it here or in that chat.";
const OPEN_CHAT = "Open that chat to respond.";
const QUEUED = /^ (\d+) follow-up instruction\(s\) are queued behind it\.$/;

export type PendingKind = "approval" | "question";

export interface PendingNotice {
  sessionId: string;
  /** The request's own ID, which the chat's pending request carries while it is open. */
  requestId: string;
  /** "approval" for any approval; "question" for anything answered with words (a question, a form). */
  kind: PendingKind;
  /** What the request is for, in full: a command, a file request, a plan, or a question's text. */
  action: string;
  /** A command, drawn in monospace. */
  command: boolean;
  /** A file request as the daemon names it: its tool and the file's name. */
  file: { tool: string; name: string } | null;
  /** The daemon says it can be answered here: a tool's approval, not a plan or a mode change. */
  answerable: boolean;
  /** The daemon's own sentence about instructions queued behind it, kept as written. */
  queued: string | null;
}

export function pendingNotice(
  item: Pick<AgentItem, "kind" | "title" | "id" | "text" | "origin">,
): PendingNotice | null {
  if (item.kind !== "system" || !item.origin || item.title !== PENDING_TITLE) return null;
  const match = NOTICE_ID.exec(item.id);
  const sessionId = match?.[1];
  const requestId = match?.[2];
  if (!sessionId || !requestId) return null;
  // The sentence, the quoted action, then where to answer it; a quote holds no blank line.
  const parts = item.text.split("\n\n");
  if (parts.length !== 3) return null;
  const [sentence = "", quoted = "", tail = ""] = parts;
  // "**Workspace / [Chat](concors://session/<id>)** needs your approval."
  if (!sentence.startsWith("**") || !sentence.includes(`(concors://session/${sessionId})**`))
    return null;
  const kind: PendingKind | null = sentence.endsWith("** needs your approval.")
    ? "approval"
    : sentence.endsWith("** needs your input.")
      ? "question"
      : null;
  if (!kind) return null;
  const lines = quoted.split("\n");
  if (!lines.every((line) => line.startsWith(">"))) return null;
  const action = lines
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
  if (!action) return null;
  const answerable = tail.startsWith(ANSWER_HERE);
  if (!answerable && !tail.startsWith(OPEN_CHAT)) return null;
  // Only a tool's approval is answerable here; anything else claiming so is not the daemon's.
  if (answerable && kind !== "approval") return null;
  const rest = tail.slice((answerable ? ANSWER_HERE : OPEN_CHAT).length);
  if (rest && !QUEUED.test(rest)) return null;
  const fileMatch = answerable ? FILE_ACTION.exec(action) : null;
  const file = fileMatch ? { tool: fileMatch[1] ?? "", name: fileMatch[2] ?? "" } : null;
  return {
    sessionId,
    requestId,
    kind,
    action,
    // A plan or a mode change is read as words; only a tool's approval runs a command.
    command: answerable && !file,
    file,
    answerable,
    queued: rest ? rest.trim() : null,
  };
}

/** The state that ends the block's first line. */
export function pendingWord(kind: PendingKind): string {
  return kind === "approval" ? "Needs your approval" : "Needs your answer";
}
