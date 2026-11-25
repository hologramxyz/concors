import type { AgentItem } from "@concors/protocol";

/**
 * Supervisor's note that a chat it watches holds queued instructions it will not send until
 * someone resumes its queue: one sentence naming the chat and how many are paused, then the
 * daemon's fixed advice to review the queue, quoted. The chat draws it as one row. It is read by
 * its title, its ID and the daemon's fixed wording; when the chat's error takes the advice's
 * place, or anything else is not in that shape, it is drawn as the daemon wrote it.
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
}

export function pausedNotice(
  item: Pick<AgentItem, "kind" | "title" | "id" | "text" | "origin">,
): PausedNotice | null {
  if (item.kind !== "system" || !item.origin || item.title !== PAUSED_TITLE) return null;
  const sessionId = NOTICE_ID.exec(item.id)?.[1];
  if (!sessionId) return null;
  // "**Workspace / [Chat](concors://session/<id>)** has 2 paused instruction(s)."
  const gap = item.text.indexOf("\n\n");
  if (gap < 0 || item.text.slice(gap + 2) !== ADVICE) return null;
  const sentence = item.text.slice(0, gap);
  if (!sentence.startsWith("**") || !sentence.includes(`(concors://session/${sessionId})**`))
    return null;
  const match = PAUSED.exec(sentence);
  if (!match) return null;
  const count = Number(match[1]);
  return { sessionId, count: Number.isSafeInteger(count) && count > 0 ? count : null };
}

/** The state that ends the row: "1 instruction paused", "3 instructions paused", or "Queue paused". */
export function pausedWords(count: number | null): string {
  if (count === null) return "Queue paused";
  return `${count} ${count === 1 ? "instruction" : "instructions"} paused`;
}

/**
 * Marks each paused-queue notice that the same chat's next paused notice follows directly, so only
 * the last of such a run offers "Review queue". Every notice stays in place.
 */
export function pausedRuns<T extends AgentItem & { pausedLater?: true }>(view: readonly T[]): T[] {
  return view.map((entry, i) => {
    const chat = pausedNotice(entry)?.sessionId;
    const next = view[i + 1];
    return chat && next && pausedNotice(next)?.sessionId === chat
      ? { ...entry, pausedLater: true as const }
      : entry;
  });
}
