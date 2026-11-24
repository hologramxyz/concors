import type { AgentItem } from "@concors/protocol";

/**
 * Supervisor's note that a chat it watches is no longer waiting on a request: posted under the
 * request's own notice ID, so it takes that notice's place once the request is answered. The
 * daemon writes it as one sentence and the request's action as a quote; the chat draws it as one
 * row. It is read by its title, its ID and the quote, and anything not in that shape is drawn as
 * the daemon wrote it. Of the sentence, only the daemon's two fixed phrases are read, to tell an
 * approval from a question; one with neither is a request of either kind.
 */
export const ANSWERED_TITLE = "Input no longer pending";

/** `supervisor-watch:<supervisor>:<session>:input:<turn>:<request>`, as the daemon names it. */
const NOTICE_ID = /^supervisor-watch:[^:]+:([^:]+):input:.+:([^:]+)$/;

/** A file request as the daemon names it: its tool, then the file's name ("Write haiku.txt"). */
const FILE_ACTION = /^(?:Write|Edit|MultiEdit|NotebookEdit|Read|File operation) [^\n/\\]+$/;

export type AnsweredKind = "approval" | "question" | "request";

export interface AnsweredNotice {
  sessionId: string;
  kind: AnsweredKind;
  /** What the request was for, in full: a command, a file request, or a question's text. */
  action: string;
  /** A command (drawn in monospace), rather than a file request or a question. */
  command: boolean;
}

/** The daemon's words for each kind: "is no longer waiting for that approval" or "…that input". */
function kindOf(sentence: string): AnsweredKind {
  if (sentence.includes("that approval")) return "approval";
  if (sentence.includes("that input")) return "question";
  return "request";
}

export function answeredNotice(
  item: Pick<AgentItem, "kind" | "title" | "id" | "text" | "origin">,
): AnsweredNotice | null {
  if (item.kind !== "system" || !item.origin || item.title !== ANSWERED_TITLE) return null;
  const sessionId = NOTICE_ID.exec(item.id)?.[1];
  if (!sessionId) return null;
  // The sentence, a blank line, then every line of the action quoted.
  const gap = item.text.indexOf("\n\n");
  if (gap < 0) return null;
  const lines = item.text.slice(gap + 2).split("\n");
  if (!lines.every((line) => line.startsWith(">"))) return null;
  const action = lines
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
  if (!action) return null;
  const kind = kindOf(item.text.slice(0, gap));
  return { sessionId, kind, action, command: kind !== "question" && !FILE_ACTION.test(action) };
}

/** "3 approvals answered", "2 questions answered", or "4 requests answered" for a mixed run. */
export function answeredSummary(items: readonly Parameters<typeof answeredNotice>[0][]): string {
  const kinds = new Set(items.map((item) => answeredNotice(item)?.kind ?? "request"));
  const [only] = kinds;
  const noun = kinds.size === 1 && only !== "request" ? only : "request";
  return `${items.length} ${noun}s answered`;
}

/**
 * Folds each run of two or more answered notices that sit next to each other into its first
 * one's row, as `stepGroups` folds quiet steps. `known` says whether a notice's chat can be named;
 * one that cannot is drawn as written, so it ends a run.
 */
export function answeredRuns<T extends AgentItem & { answered?: T[] }>(
  view: readonly T[],
  known: (sessionId: string) => boolean,
): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.length > 1) out.push({ ...first, answered: run } as T);
    else out.push(...run);
    run = [];
  };
  for (const entry of view) {
    const notice = answeredNotice(entry);
    if (notice && known(notice.sessionId)) run.push(entry);
    else {
      flush();
      out.push(entry);
    }
  }
  flush();
  return out;
}
