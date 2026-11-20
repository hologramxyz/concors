/** An opening line this short is kept whole rather than cut to its first sentence. */
const WHOLE = 200;

/**
 * One line that says what a reply amounts to, taken from the reply itself: no model is asked, so
 * it costs nothing and never invents. A line the agent marked as its TL;DR or summary wins;
 * otherwise the first line that says something (its first sentence if it is long), skipping code, tables and
 * bare labels such as "## Summary", with Markdown removed.
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
  const said = marked ?? lines.find((line) => !isLabel(line) && !/^(\||[-=*_]{3,}$)/.test(line));
  if (!said) return "";
  const plain = stripMarkdown(said);
  // A short opening says it all; only a long one is cut to its first sentence.
  const sentence =
    plain.length <= WHOLE ? plain : (/^(.{20,}?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain);
  const line = sentence.replace(/:$/, "").trim();
  return line.length > limit ? line.slice(0, limit - 1).trimEnd() + "…" : line;
}

/** A heading or bold line of three words or fewer, which names a section rather than saying anything. */
function isLabel(line: string) {
  const text = stripMarkdown(line).replace(/:$/, "");
  const marked = /^#{1,6}\s/.test(line) || /^(\*\*|__)[^*_]+(\*\*|__):?$/.test(line);
  return marked && text.split(/\s+/).length <= 3;
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
