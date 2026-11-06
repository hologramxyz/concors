import type { AgentItem } from "@concors/protocol";

/**
 * Up and Down in a chat's prompt box step through what was sent in that chat, as in a shell.
 *
 * Up only takes over when nothing typed would be lost: the box is empty, still shows a recalled
 * prompt as it was recalled, or has its caret at the very start. Otherwise, as inside a prompt of
 * several lines, the keys move the caret as usual. Leaving the newest recalled prompt with Down
 * brings back what was in the box before the first Up.
 */
export interface PromptRecall {
  /** Which prompt shows, counted back from the newest (0), or null when none is recalled. */
  index: number | null;
  /** What the box held before the first Up. */
  stash: string;
}

export const NO_RECALL: PromptRecall = { index: null, stash: "" };

/** The prompts sent in a chat, oldest first, without repeating one sent twice in a row. */
export function sentPrompts(items: readonly AgentItem[]): string[] {
  const prompts: string[] = [];
  for (const item of items) {
    if (item.kind !== "user" || !item.text.trim()) continue;
    if (prompts[prompts.length - 1] !== item.text) prompts.push(item.text);
  }
  return prompts;
}

export function recallStep({
  key,
  history,
  recall,
  draft,
  selectionStart,
  selectionEnd,
}: {
  key: string;
  /** Oldest first, as `sentPrompts` gives them. */
  history: readonly string[];
  recall: PromptRecall;
  draft: string;
  selectionStart: number;
  selectionEnd: number;
}): { recall: PromptRecall; draft: string } | null {
  if (selectionStart !== selectionEnd) return null;
  const shown = recall.index === null ? undefined : history[history.length - 1 - recall.index];
  const recalled = shown !== undefined && draft === shown;
  if (key === "ArrowUp") {
    const firstLine = !draft.slice(0, selectionStart).includes("\n");
    if (!(selectionStart === 0 || (firstLine && (draft === "" || recalled)))) return null;
    const index = recalled && recall.index !== null ? recall.index + 1 : 0;
    const prompt = history[history.length - 1 - index];
    if (prompt === undefined) return null;
    return { recall: { index, stash: recalled ? recall.stash : draft }, draft: prompt };
  }
  if (key === "ArrowDown") {
    if (!recalled || recall.index === null || draft.slice(selectionEnd).includes("\n")) return null;
    if (recall.index === 0) return { recall: NO_RECALL, draft: recall.stash };
    const index = recall.index - 1;
    return { recall: { ...recall, index }, draft: history[history.length - 1 - index] ?? "" };
  }
  return null;
}
