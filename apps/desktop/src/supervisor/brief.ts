const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/;
/** An opening line this short is kept whole rather than cut to its first sentence. */
const WHOLE = 200;

/**
 * One line that says what a reply amounts to, taken from the reply itself: no model is asked, so
 * it costs nothing and never invents. A line the agent marked as its TL;DR or summary wins;
 * otherwise the first line that says something (its first sentence if it is long), skipping code, tables and
 * titles such as "## Summary" (unless nothing else is said), with Markdown removed.
 */
export function briefLine(reply: string, limit = 300): string {
  const lines = reply
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const marked = lines
    .map(
      (line) =>
        /^(?:[#>*\-\s]*)(?:\*\*|__)?(?:tl;?dr|summary)(?:\*\*|__)?\s*[:—-]\s*(?:\*\*|__)?\s*(.+)$/i.exec(
          line,
        )?.[1],
    )
    .find(Boolean);
  const prose = lines.filter((line) => !/^(\||[-=*_]{3,}$)/.test(line));
  // A title names the reply rather than saying what it found, so prose after it is preferred.
  const said = marked ?? prose.find((line) => !isTitle(line)) ?? prose[0];
  if (!said) return "";
  // A reply that is only a list is summed up by its first item, saying how many follow.
  const items = marked ? 0 : prose.filter((line) => LIST_ITEM.test(line)).length;
  const count = LIST_ITEM.test(said) && items > 1 ? `1 of ${items}: ` : "";
  const plain = count + stripMarkdown(said);
  // A short opening says it all; only a long one is cut to its first sentence.
  const sentence =
    plain.length <= WHOLE ? plain : (/^(.{20,}?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain);
  const line = sentence.replace(/:$/, "").trim();
  return line.length > limit ? line.slice(0, limit - 1).trimEnd() + "…" : line;
}

/** A Markdown heading, or a line that is bold from end to end: a title, not a statement. */
function isTitle(line: string) {
  return /^#{1,6}\s/.test(line) || /^(\*\*|__)[^*_]+(\*\*|__):?$/.test(line);
}

function stripMarkdown(line: string) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
