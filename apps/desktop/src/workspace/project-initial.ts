const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Keep the compact workspace label readable, including non-Latin names and emoji. */
export function projectInitial(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next().value?.segment;
  return first?.toLocaleUpperCase() || "?";
}
