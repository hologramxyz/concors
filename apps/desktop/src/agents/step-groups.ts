import type { AgentItem } from "@concors/protocol";
import type { TimelineEntry } from "./thinking";
import { parseToolTitle } from "./tool-label";

/**
 * A finished turn's quiet steps, folded into one summary line each run. A quiet step is a call
 * the reader needs nothing from: a command, a read, an edit, a search, an MCP call, or the
 * reasoning between them. A run ends at whatever must stay in view on its own: a message, a
 * sub-agent, a plan, a failed step, a call an open request is about, a system line.
 *
 * This only rearranges what `timelineView` returns; items reach the screen unchanged. A turn
 * still in progress is left as it is: how a live run reads is a decision of its own.
 */

export type StepKind = "tool" | "command" | "read" | "edit" | "search" | "web" | "thinking";

const WEB_TOOLS = new Set(["search the web", "websearch", "web_search", "webfetch", "web_fetch"]);

export function stepKind(item: AgentItem): StepKind | undefined {
  if (item.kind !== "tool") return undefined;
  const type = item.presentation?.type;
  if (type === "thinking") return "thinking";
  if (type === "shell") return "command";
  if (type === "files") return item.presentation?.fileOperation === "read" ? "read" : "edit";
  if (type === "search")
    return WEB_TOOLS.has(parseToolTitle(item.title).tool.toLowerCase()) ? "web" : "search";
  if (type === "mcp" || type === undefined) return "tool";
  return undefined;
}

/**
 * `liveTurn` is the turn still in progress, whose rows stay as they are. `waiting` holds the
 * calls an open request names (its `sourceItemId`), which never fold out of sight.
 */
export function stepGroups(
  view: readonly TimelineEntry[],
  liveTurn: string | null,
  waiting: ReadonlySet<string> = new Set(),
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let run: AgentItem[] = [];
  const flush = () => {
    const counted = run.filter((item) => stepKind(item) !== "thinking").length;
    const first = run[0];
    // One step needs no summary: it and any reasoning beside it are shown as they are.
    if (first && counted > 1) out.push({ ...first, steps: run, status: runStatus(run) });
    else
      for (const item of run)
        out.push(stepKind(item) === "thinking" ? item : { ...item, quiet: true });
    run = [];
  };
  for (const entry of view) {
    if (entry.turnId === liveTurn) {
      flush();
      out.push(entry);
      continue;
    }
    // Inside a finished turn, today's same-tool folds open into their calls, one row each.
    for (const item of entry.group ?? [entry]) {
      const kind = stepKind(item);
      const quiet = kind && item.status !== "failed" && !waiting.has(item.id);
      if (quiet && run[0] && run[0].turnId !== item.turnId) flush();
      if (quiet) run.push(item);
      else {
        flush();
        // A failed step reads as a plain row too, with its error; a call awaiting an answer
        // keeps today's card until the live states are designed.
        if (kind && kind !== "thinking" && item.status === "failed")
          out.push({ ...item, quiet: true });
        else out.push(item);
      }
    }
  }
  flush();
  return out;
}

function runStatus(run: readonly AgentItem[]): AgentItem["status"] {
  return run.some((item) => item.status === "interrupted") ? "interrupted" : "completed";
}

/** Distinct files for reads and edits, calls for the rest; reasoning is not counted. */
export function stepCounts(steps: readonly AgentItem[]): Map<StepKind, number> {
  const files = new Map<StepKind, Set<string>>();
  const counts = new Map<StepKind, number>();
  for (const item of steps) {
    const kind = stepKind(item);
    if (!kind || kind === "thinking") continue;
    if (kind === "read" || kind === "edit") {
      const set = files.get(kind) ?? new Set<string>();
      const paths = item.presentation?.files?.map((file) => file.path) ?? [];
      for (const path of paths.length ? paths : [item.text]) set.add(path);
      files.set(kind, set);
      counts.set(kind, set.size);
    } else counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

const ORDER: StepKind[] = ["tool", "command", "read", "edit", "search", "web"];

function phrase(kind: StepKind, n: number, first: boolean): string {
  const plural = (one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const verb = (word: string) => (first ? word : word.toLowerCase());
  switch (kind) {
    case "command":
      return `${verb("Ran")} ${plural("command", "commands")}`;
    case "read":
      return `${verb("Read")} ${plural("file", "files")}`;
    case "edit":
      return `${verb("Edited")} ${plural("file", "files")}`;
    case "web":
      return `${verb("Searched")} the web ${plural("time", "times")}`;
    case "search":
      return `${verb("Searched")} the code ${plural("time", "times")}`;
    default:
      return `${verb("Used")} ${plural("tool", "tools")}`;
  }
}

function list(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "Ran 2 commands and edited 1 file". Up to three kinds are named; past that, the two largest,
 * then the rest as a count: "Edited 2 files, searched the web 2 times and 4 more".
 */
export function stepSummary(steps: readonly AgentItem[]): string {
  const counts = stepCounts(steps);
  const kinds = ORDER.filter((kind) => counts.get(kind));
  const count = (kind: StepKind) => counts.get(kind) ?? 0;
  if (kinds.length <= 3) return list(kinds.map((kind, i) => phrase(kind, count(kind), i === 0)));
  // A stable sort keeps the fixed order between kinds of the same size.
  const sorted = [...kinds].sort((x, y) => count(y) - count(x));
  const more = sorted.slice(2).reduce((sum, kind) => sum + count(kind), 0);
  const named = sorted.slice(0, 2).map((kind, i) => phrase(kind, count(kind), i === 0));
  return list([...named, `${more} more`]);
}

/** "+12 −3" for an edit, from its unified diff. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

/**
 * The line of a failed call's output that says what went wrong: the first that names an error
 * or failure, else the first line of output. The daemon puts the folder a command ran in first
 * and its exit code last, and neither says what failed.
 */
export function firstErrorLine(item: AgentItem): string {
  const lines = item.detail
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line && line !== item.presentation?.cwd?.trim() && !/^Exit code:/i.test(line),
    );
  return lines.find((line) => /error|fail|✗|×/i.test(line)) ?? lines[0] ?? "";
}
