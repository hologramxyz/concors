/**
 * One line that says what a reply amounts to, taken from the reply itself: no model is asked, so
 * it costs nothing and never invents. A line the agent marked as its TL;DR or summary wins;
 * otherwise the first sentence of the first line that says something, skipping code, tables and
 * bare labels such as "## Summary", with Markdown removed.
 */
export function briefLine(reply: string, limit = 160): string {
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
  const sentence = /^(.{20,}?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
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
