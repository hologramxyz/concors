import type { AgentItem } from "@concors/protocol";

/**
 * Supervisor's note that a chat it watches holds queued instructions it will not send until
 * someone resumes its queue: one sentence naming the chat and how many are paused, then quoted,
 * either the daemon's fixed advice to review the queue or the chat's error. It is read by its
 * title, its ID and the daemon's fixed wording; anything not in that shape is drawn as the daemon
 * wrote it.
 */
export const PAUSED_TITLE = "Queued work paused";

/** `supervisor-watch:<supervisor>:<session>:paused:<turn>:<queued IDs…>`, as the daemon names it. */
const NOTICE_ID = /^supervisor-watch:[^:]+:([^:]+):paused:.+$/;

const ADVICE = "> Open the target chat to review its queue before resuming.";
/** The sentence's end: "** has 2 paused instruction(s)." */
const PAUSED = /\*\* has (\S+) paused instruction\(s\)\.$/;

export interface PausedNotice {
  sessionId: string;
  /** How many instructions are paused, or null when the daemon's number cannot be read. */
  count: number | null;
  /** The chat's error, quoted in the advice's place, or null when the advice is there. */
  error: string | null;
}

export function pausedNotice(
  item: Pick<AgentItem, "kind" | "title" | "id" | "text" | "origin">,
): PausedNotice | null {
  if (item.kind !== "system" || !item.origin || item.title !== PAUSED_TITLE) return null;
  const sessionId = NOTICE_ID.exec(item.id)?.[1];
  if (!sessionId) return null;
  // "**Workspace / [Chat](concors://session/<id>)** has 2 paused instruction(s)."
  const gap = item.text.indexOf("\n\n");
  if (gap < 0) return null;
  const body = item.text.slice(gap + 2);
  const error = body === ADVICE ? null : unquote(body);
  if (body !== ADVICE && error === null) return null;
  const sentence = item.text.slice(0, gap);
  if (!sentence.startsWith("**") || !sentence.includes(`(concors://session/${sessionId})**`))
    return null;
  const match = PAUSED.exec(sentence);
  if (!match) return null;
  const count = Number(match[1]);
  return { sessionId, count: Number.isSafeInteger(count) && count > 0 ? count : null, error };
}

/** A Markdown quote's text, or null when a line is not quoted or nothing is in it. */
function unquote(text: string): string | null {
  const lines = text.split("\n");
  if (!lines.every((line) => line.startsWith(">"))) return null;
  const quoted = lines
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
  return quoted || null;
}

/** A quiet row's state: "1 instruction paused", "3 instructions paused", or "Queue paused". */
export function pausedWords(count: number | null): string {
  if (count === null) return "Queue paused";
  return `${count} ${count === 1 ? "instruction" : "instructions"} paused`;
}

/** What a paused queue holds, under its state: "1 instruction waiting", "3 instructions waiting". */
export function waitingWords(count: number): string {
  return `${count} ${count === 1 ? "instruction" : "instructions"} waiting`;
}

/**
 * Marks each paused-queue notice that the same chat posts another after, anywhere later in the
 * chat, so only a chat's most recent one can ask for a person. Every notice stays in place.
 */
export function pausedRuns<T extends AgentItem & { pausedLater?: true }>(view: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of [...view].reverse()) {
    const chat = pausedNotice(entry)?.sessionId;
    if (chat && seen.has(chat)) out.push({ ...entry, pausedLater: true as const });
    else {
      if (chat) seen.add(chat);
      out.push(entry);
    }
  }
  return out.reverse();
}
