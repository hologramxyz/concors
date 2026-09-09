import type { TerminalInfo } from "@concors/protocol";

/** Conservative live UI signals adapted from Herdr's Codex/Claude detection manifests.
 * Never infer a working turn merely from an existing process or a burst of terminal output.
 */
export function terminalAgentActivity(
  agent: TerminalInfo["detectedAgent"] | TerminalInfo["profile"],
  title: string,
  liveLines: readonly string[],
  previous: NonNullable<TerminalInfo["agentActivity"]> = "unknown",
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
    return claudeActivity(title, liveLines, previous);
  }
  return "unknown";
}

/** Herdr claude.toml (2026.09.04.1) screen regions and lifecycle signals.
 * Inspect the live viewport, never scrollback or output frequency. The prompt body
 * is excluded so typing an example spinner cannot turn an idle agent into working.
 */
function claudeActivity(
  title: string,
  lines: readonly string[],
  previous: NonNullable<TerminalInfo["agentActivity"]>,
): NonNullable<TerminalInfo["agentActivity"]> {
  const rule = (line: string) => /^\s*(?:─{3,}|─+\s*$)/u.test(line);
  const borders = lines.flatMap((line, index) => (rule(line) ? [index] : []));
  const bottom = lines.filter((line) => line.trim()).slice(-12);
  const tail = bottom.slice(-3).join("\n");
  if (
    /showing detailed transcript/i.test(tail) &&
    /ctrl\+[oe]|↑↓ scroll|\? for shortcuts/i.test(tail)
  )
    return previous;
  const top = borders.at(-2);
  const end = borders.at(-1);
  const body = top !== undefined && end !== undefined ? lines.slice(top + 1, end) : [];
  const hasPrompt = body.some((line) => /^\s*❯/u.test(line));
  const above = hasPrompt ? lines.slice(0, top) : lines;
  const recent = above.filter((line) => line.trim()).slice(-12);
  const form = lines.slice((end ?? -1) + 1).join("\n");
  const recentText = recent.join("\n");
  // Live selection controls take precedence over a stale title/spinner behind a dialog.
  if (
    /esc to cancel/i.test(form) &&
    (/enter to confirm|enter to select/i.test(form) ||
      (/do you want to proceed\?/i.test(form) && /^\s*❯?\s*\d\.\s*(?:yes|no)\b/im.test(form)) ||
      (/MCP server .+ requests your input/i.test(form) &&
        /^\s*❯?\s*(?:Accept|Decline)\b/im.test(form)))
  )
    return "needs_input";
  if (/^[\u2800-\u28ff\u25d0-\u25d3] /u.test(title)) return "working";
  // Claude 2.1.236 puts the interrupt hint BELOW the prompt and may insert an
  // effort row between the spinner and its top border. Neither is prompt input.
  if (hasPrompt && /^\s*[⏸⏵].*\besc to interrupt(?:\s|·|$)/mu.test(form)) return "working";
  const statusRegion = recent.filter((line) => !/^\s*●\s+\S.*\/effort\s*$/u.test(line));
  // Only the final status above the prompt is live; older transcript examples aren't.
  const statusLines = hasPrompt ? statusRegion.slice(-1) : statusRegion;
  if (
    statusLines.some(
      (line) =>
        /^\s*[⏸⏵].*esc to interrupt(?:\s|·|$)/u.test(line) ||
        /^\s*[*·✢✶✻✽]\s+\S.*…(?:\s+\(\d+[smh](?:\s|·)|\s*$)/u.test(line) ||
        /^\s*[*·✢✶✻✽]\s+Waiting for [1-9]\d* background agents? to finish\s*$/u.test(line),
    )
  )
    return "working";
  if (
    /^[*·✢✶✻✽][ \t]+\S[^\n]*?(?:\n[ \t]+[^\n]*?){0,3}·\s+[1-9]\d*\s+MCP\s+tasks?\s+still\s+running\s*$/mu.test(
      recentText,
    ) &&
    !/esc to cancel|waiting for permission|do you want to proceed\?/i.test(recentText)
  )
    return "working";
  if (hasPrompt || /^✳ /u.test(title)) return "idle";
  return "unknown";
}
