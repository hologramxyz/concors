import type { AgentItem } from "@concors/protocol";

/**
 * Codex summaries are bold headings, one per part. Older daemons glued the parts together
 * (`**A****B**`) or split them with a single newline, which Markdown renders as one paragraph.
 */
export function thinkingText(text: string): string {
  return text
    .replace(/\*\*\*\*/g, "**\n\n**")
    .replace(/\*\*\n(?!\n)/g, "**\n\n")
    .trim();
}

function lines(text: string): string[] {
  return thinkingText(text)
    .split("\n")
    .map((line) => line.replace(/[*_`#>]+/g, "").trim())
    .filter(Boolean);
}

/** The latest step of a reasoning summary without Markdown markers: what the agent acted on. */
export function thinkingPreview(text: string): string {
  return lines(text).at(-1) ?? "";
}

/** A summary that is just its preview line has nothing more to show when expanded. */
export function thinkingExpandable(text: string): boolean {
  return lines(text).length > 1;
}

/**
 * Reasoning rows that would add nothing to the timeline: empty summaries (Codex keeps most
 * reasoning encrypted and still reports the item) and the copies older Claude sessions saved under
 * a second id with the same text. The last copy is kept, since the earlier one was the stream.
 */
function redundantThinking(items: readonly AgentItem[], hidden: Set<string>) {
  const seen = new Set<string>();
  for (const item of [...items].reverse()) {
    if (item.presentation?.type !== "thinking") continue;
    const text = item.text.trim();
    const key = `${item.turnId}\0${text}`;
    if (!text || seen.has(key)) hidden.add(item.id);
    seen.add(key);
  }
}

/**
 * A prompt never follows its own turn's completion. Older daemons saved a second copy of a prompt
 * when a replay could not find the first one, and it sorted to the bottom of the conversation.
 */
function replayedPrompts(items: readonly AgentItem[], hidden: Set<string>) {
  const settled = new Set<string>();
  for (const item of items) {
    if (item.kind === "system" && item.id === `turn:${item.turnId}` && item.status !== "running")
      settled.add(item.turnId);
    else if (item.kind === "user" && settled.has(item.turnId)) hidden.add(item.id);
  }
}

/**
 * What the timeline renders: items minus the redundant ones, with each run of adjacent reasoning
 * steps folded into one row, since Codex reports a separate item per short heading.
 */
export function timelineView(
  items: readonly AgentItem[],
  hidden: ReadonlySet<string> = new Set(),
): AgentItem[] {
  const skip = new Set(hidden);
  redundantThinking(items, skip);
  replayedPrompts(items, skip);
  const view: AgentItem[] = [];
  for (const item of items) {
    if (skip.has(item.id)) continue;
    const last = view.at(-1);
    if (
      item.presentation?.type === "thinking" &&
      last?.presentation?.type === "thinking" &&
      last.turnId === item.turnId
    )
      view[view.length - 1] = {
        ...last,
        text: `${thinkingText(last.text)}\n\n${thinkingText(item.text)}`,
        status: item.status,
      };
    else view.push(item);
  }
  return view;
}
