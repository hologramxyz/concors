/**
 * The Markdown a quote holds, without its quote markers. A Copy button uses this rather than the
 * rendered text, which would lose list numbers, links and emphasis from a prompt meant for pasting.
 */
export function quotedSource(source: string, start: number, end: number): string {
  return source
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^\s*> ?/, ""))
    .join("\n")
    .trim();
}
