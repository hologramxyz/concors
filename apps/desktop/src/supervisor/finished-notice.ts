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

/**
 * Marks each turn-ended notice that the same chat posts another after, anywhere later in the chat,
 * so only a chat's most recent result can ask for a person. Every notice stays in place.
 */
export function finishedRuns<T extends AgentItem & { finishedLater?: true }>(
  view: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of [...view].reverse()) {
    const chat = finishedNotice(entry)?.sessionId;
    if (chat && seen.has(chat)) out.push({ ...entry, finishedLater: true as const });
    else {
      if (chat) seen.add(chat);
      out.push(entry);
    }
  }
  return out.reverse();
}

/** A Markdown image, `![alt](source "title")`, which a quoted reply can only name, never show. */
const IMAGE = /!\[(?:[^\]\\]|\\.)*\]\((?:<[^>]*>|[^()\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;

/**
 * A quoted reply without its images, and how many it had. The images stay in the chat they came
 * from, which the notice's row links to; the quote says how many there are instead of showing each
 * as missing. Images in a code block are text, and stay.
 */
export function quoteImages(quote: string): { text: string; images: number } {
  let images = 0;
  let fence: string | null = null;
  const lines: string[] = [];
  for (const line of quote.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence)) fence = null;
      lines.push(line);
      continue;
    }
    if (marker) {
      fence = marker;
      lines.push(line);
      continue;
    }
    let found = 0;
    const marked = line.replace(IMAGE, () => {
      found++;
      return HOLE;
    });
    if (!found) {
      lines.push(line);
      continue;
    }
    images += found;
    const kept = withoutHoles(marked);
    // A line that held only images goes with them, rather than leaving a gap.
    if (kept) lines.push(kept);
  }
  return { text: lines.join("\n").replace(/^\n+|\n+$/g, ""), images };
}

/** Where an image stood in a line, until the line is tidied. */
const HOLE = "\u0000";
/** Words that only join or point at what was beside them: "And", "see", "here is". */
const CONNECTING = new Set(
  "a an and also as at below above but for here in is it its of on or plus see so the then there this these to with".split(
    " ",
  ),
);

/**
 * A line with its images taken out and no stray fragment left: a sentence that held an image and
 * has only connecting words and punctuation without it ("And ![x](x.png).") goes, and so do the
 * doubled spaces and the space before a full stop that its removal left. All other words stay.
 */
function withoutHoles(line: string): string {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const sentences = line.slice(indent.length).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => {
    if (!sentence.includes(HOLE)) return true;
    const words =
      sentence
        .split(HOLE)
        .join(" ")
        .toLowerCase()
        .match(/[\p{L}\p{N}']+/gu) ?? [];
    return words.some((word) => !CONNECTING.has(word));
  });
  const text = kept
    .join(" ")
    .split(HOLE)
    .join("")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  return text ? indent + text : "";
}

/** "1 image in the chat", "3 images in the chat". */
export function imagesLine(images: number): string {
  return `${images} ${images === 1 ? "image" : "images"} in the chat`;
}

/**
 * A quoted reply as one paragraph of its lines, for a row folded to two lines: each line as the
 * agent wrote it, without the blocks around it. A heading, list item or quote keeps its words, a
 * numbered item its number; a code block's lines read as inline code and a table's rows as their
 * cells; rules and blank lines go. Links, emphasis and inline code keep their inline look.
 */
export function quotePreview(quote: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of quote.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence)) fence = null;
      else if (line.trim()) lines.push(inlineCode(line.trim()));
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    let text = line.trim().replace(/^(>\s?)+/, "");
    // Rules, a setext heading's underline and a table's alignment row carry no words.
    if (
      !text ||
      /^([-*_=]\s*){3,}$/.test(text) ||
      /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?$/.test(text)
    )
      continue;
    text = text
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+#+$/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^(\d+)([.)])\s+/, "$1\\$2 ");
    if (text.startsWith("|"))
      text = text
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
        .join(" | ");
    // Nothing left to open a block of its own when the lines are joined.
    lines.push(text.replace(/^([<#>=+-])/, "\\$1"));
  }
  return lines.join("  \n");
}

/** A line of code as inline code, fenced past any run of backticks in it. */
function inlineCode(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${ticks}${pad}${code}${pad}${ticks}`;
}

/**
 * How many characters to take off the end of the text a clamp cuts, so its "…" follows a word, not
 * a stop: trailing full stops, commas, colons, semicolons and spaces go; "?" and "!" stay.
 */
export function ellipsisTrim(text: string): number {
  return /[.,:;\s]*$/.exec(text)?.[0].length ?? 0;
}
