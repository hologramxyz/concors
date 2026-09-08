import type { TerminalInfo } from "@concors/protocol";

/** Conservative live UI signals adapted from Herdr's Codex/Claude detection manifests.
 * Never infer a working turn merely from an existing process or a burst of terminal output.
 */
export function terminalAgentActivity(
  agent: TerminalInfo["detectedAgent"] | TerminalInfo["profile"],
  title: string,
  liveLines: readonly string[],
): NonNullable<TerminalInfo["agentActivity"]> {
  if (agent === "codex") {
    if (/\bAction Required\b/i.test(title)) return "needs_input";
    if (/(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)/u.test(title)) return "working";
    const bottom = liveLines.filter((line) => line.trim()).slice(-3);
    if (bottom.some((line) => /^[•◦]\s+Working \([^)]*esc to interrupt\)(?: · .*)?$/u.test(line)))
      return "working";
    if (title.trim()) return "idle";
  }
  if (agent === "claude") {
    if (/^[\u2800-\u28ff\u25d0-\u25d3] /u.test(title)) return "working";
  }
  return "unknown";
}
