import type { AgentItem } from "@concors/protocol";

/**
 * Supervisor's note that a chat it watches has ended its turn: one sentence naming the chat and
 * how the turn ended, then the agent's last reply, the chat's error, or the daemon's sentence that
 * no reply was saved. The chat draws it as one row with the reply under it. It is read by its
 * title, its ID and the daemon's fixed wording, and anything not in that shape is drawn as the
 * daemon wrote it.
 */
export const FINISHED_TITLE = "Agent result";

/** `supervisor-watch:<supervisor>:<session>:<turn>:<status>`, as the daemon names it. */
const NOTICE_ID = /^supervisor-watch:[^:]+:([^:]+):.+:(done|failed|interrupted)$/;

const REPLY_LABEL = "Agent’s reply:";
const CUT_NOTE = "Read the original chat for the full reply.";
const NO_REPLY = "No final text reply was saved. Open the chat for its tool output.";

export type FinishedState = "done" | "failed" | "interrupted";

export interface FinishedNotice {
  sessionId: string;
  state: FinishedState;
  /** The agent's last reply, or the chat's error when it saved none; null when neither. */
  quote: string | null;
  /** The daemon cut the reply short; the chat holds the rest. */
  cut: boolean;
}

/** The daemon's word for each ending: "finished" for a done turn, else the status itself. */
const outcome = (state: FinishedState) => (state === "done" ? "finished" : state);

/** A Markdown quote's text, or null when a line is not quoted or nothing is in it. */
function unquote(text: string): string | null {
  const lines = text.split("\n");
  if (!lines.every((line) => line.startsWith(">"))) return null;
  const quoted = lines.map((line) => line.replace(/^> ?/, "")).join("\n");
  return quoted.trim() ? quoted : null;
}

export function finishedNotice(
  item: Pick<AgentItem, "kind" | "title" | "id" | "text" | "origin">,
): FinishedNotice | null {
  if (item.kind !== "system" || !item.origin || item.title !== FINISHED_TITLE) return null;
  const match = NOTICE_ID.exec(item.id);
  if (!match) return null;
  const [, sessionId = "", state] = match as unknown as [string, string, FinishedState];
  const gap = item.text.indexOf("\n\n");
  if (gap < 0) return null;
  // "**Workspace / [Chat](concors://session/<id>)** finished."
  const sentence = item.text.slice(0, gap);
  if (!sentence.includes(`(concors://session/${sessionId})**`)) return null;
  if (!sentence.endsWith(`** ${outcome(state)}.`)) return null;
  const body = item.text.slice(gap + 2);
  if (body === NO_REPLY) return { sessionId, state, quote: null, cut: false };
  if (body.startsWith(`${REPLY_LABEL}\n\n`)) {
    let reply = body.slice(REPLY_LABEL.length + 2);
    const cut = reply.endsWith(`\n\n${CUT_NOTE}`);
    if (cut) reply = reply.slice(0, -(CUT_NOTE.length + 2));
    const quote = unquote(reply);
    return quote === null ? null : { sessionId, state, quote, cut };
  }
  // The chat's error, quoted with no label.
  const quote = unquote(body);
  return quote === null ? null : { sessionId, state, quote, cut: false };
}

/** The word that ends the row: "Finished", "Failed", or "Stopped" as a stopped step reads. */
export function finishedWord(state: FinishedState): string {
  return state === "done" ? "Finished" : state === "failed" ? "Failed" : "Stopped";
}
