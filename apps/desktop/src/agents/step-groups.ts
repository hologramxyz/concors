import type { AgentItem } from "@concors/protocol";
import type { TimelineEntry } from "./thinking";
import { parseToolTitle } from "./tool-label";

/**
 * A finished turn's quiet steps, folded into one summary line each run. A quiet step is a call
 * the reader needs nothing from: a command, a read, an edit, a search, an MCP call, or the
 * reasoning between them. A run ends at whatever must stay in view on its own: a message, a
 * sub-agent, a plan, a failed step, a call an open request is about, a system line. A granted
 * permission is not a line of its own: it shows on the step it was for.
 *
 * The turn in progress folds the same way, so nothing snaps into place when it ends. Its open run
 * (the one at its end, or one with calls still running) has no ✓ yet, and the step it is on now
 * leaves the run for the live line under it (see `liveStep`).
 *
 * This only rearranges what `timelineView` returns; items reach the screen unchanged.
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

/** "Allowed once" for a permission the user granted; nothing for one declined or cancelled. */
export function approvalMark(item: AgentItem): string | undefined {
  if (item.kind !== "system" || item.title !== "Permission") return undefined;
  const text = item.text.trim();
  const allow = /^Allow\s+(.+)$/i.exec(text);
  if (allow) return `Allowed ${allow[1]}`;
  return /^(Approve|Apply)/i.test(text) ? "Approved" : undefined;
}

/** Calls that can stop for a permission. Reads and code searches seldom do. */
const ASKS: ReadonlySet<StepKind> = new Set(["command", "edit", "web", "tool"]);

/**
 * Which step each granted permission was for. A permission line names no call: it is saved when
 * the user answers, after the call it was for, and the agent asks in the order it made its calls.
 * So each answer goes to the oldest call since the last message that still has none, or, when no
 * such call came first, to the next step.
 */
function approvals(items: readonly AgentItem[], waiting: ReadonlySet<string>) {
  const marks = new Map<string, string>();
  const used = new Set<string>();
  let asked: AgentItem[] = [];
  let early: { id: string; mark: string }[] = [];
  let turn: string | undefined;
  for (const item of items) {
    if (item.turnId !== turn || item.kind === "user" || item.kind === "assistant") {
      asked = [];
      early = [];
      turn = item.turnId;
    }
    const mark = approvalMark(item);
    if (mark) {
      const call = asked.shift();
      if (call) {
        marks.set(call.id, mark);
        used.add(item.id);
      } else early.push({ id: item.id, mark });
      continue;
    }
    const kind = stepKind(item);
    if (!kind || kind === "thinking" || waiting.has(item.id)) continue;
    const answer = early.shift();
    if (answer) {
      marks.set(item.id, answer.mark);
      used.add(answer.id);
    } else if (ASKS.has(kind)) asked.push(item);
  }
  return { marks, used };
}

/**
 * The step the turn in progress is on: its latest call still running. A call an open request
 * names keeps its own card, so it is never this step.
 */
export function liveStep(
  view: readonly TimelineEntry[],
  liveTurn: string | null,
  waiting: ReadonlySet<string> = new Set(),
): AgentItem | undefined {
  if (liveTurn === null) return undefined;
  return view
    .flatMap((entry) => (entry.turnId === liveTurn ? (entry.group ?? [entry]) : []))
    .findLast((item) => item.status === "running" && stepKind(item) && !waiting.has(item.id));
}

/**
 * `liveTurn` is the turn still in progress, if any. `waiting` holds the calls an open request
 * names (its `sourceItemId`), which never fold out of sight.
 */
export function stepGroups(
  view: readonly TimelineEntry[],
  liveTurn: string | null,
  waiting: ReadonlySet<string> = new Set(),
): TimelineEntry[] {
  // Today's same-tool folds open into their calls, one row each.
  const flat = view.flatMap((entry) => entry.group ?? [entry]);
  const { marks, used } = approvals(flat, waiting);
  const current = liveStep(view, liveTurn, waiting)?.id;
  const out: TimelineEntry[] = [];
  let run: TimelineEntry[] = [];
  /** `last`: nothing in the run's turn comes after it, so in the live turn it is still open. */
  const flush = (last: boolean) => {
    const live =
      run[0]?.turnId === liveTurn && (last || run.some((item) => item.status === "running"));
    // The step in progress is the live line's, not the run's.
    const steps = live ? run.filter((item) => item.id !== current) : run;
    const counted = steps.filter((item) => stepKind(item) !== "thinking").length;
    const first = run[0];
    // One step needs no summary: it and any reasoning beside it are shown as they are.
    if (first && counted > 1)
      out.push({
        ...first,
        steps,
        ...(live
          ? { status: "running" as const, ...(last ? { live: true as const } : {}) }
          : { status: runStatus(steps) }),
      });
    else
      for (const item of steps)
        out.push(stepKind(item) === "thinking" ? item : { ...item, quiet: true });
    run = [];
  };
  for (const entry of flat) {
    // A granted permission shows on the step it was for, not as a line between steps.
    if (used.has(entry.id)) continue;
    const approval = marks.get(entry.id);
    const item: TimelineEntry = approval ? { ...entry, approval } : entry;
    const kind = stepKind(item);
    const quiet = kind && item.status !== "failed" && !waiting.has(item.id);
    if (run[0] && run[0].turnId !== item.turnId) flush(true);
    if (quiet) run.push(item);
    else {
      flush(false);
      // A failed step reads as a plain row too, with its error; a call an open request names
      // keeps its card, where the request is answered.
      if (kind && kind !== "thinking" && item.status === "failed")
        out.push({ ...item, quiet: true });
      else out.push(item);
    }
  }
  flush(true);
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

/** A failed command's exit code: as the daemon reported it, else from the output's own line. */
export function exitCode(item: AgentItem): number | undefined {
  const code = item.presentation?.exitCode;
  if (typeof code === "number") return code;
  const line = /^Exit code:?\s*(-?\d+)\s*$/im.exec(item.detail);
  return line ? Number(line[1]) : undefined;
}

const EXIT_LINE = /^Exit code:?\s*-?\d+$/i;
/** Test runners' totals ("ℹ fail 1", "# fail 1", "Tests: 1 failed") and headers say no more. */
const TALLY =
  /^(?:[ℹ#]\s*)?(?:tests?|test files|suites?|pass(?:ed)?|fail(?:ed|ures)?|cancelled|skipped|todo|duration_ms)\b[\s:]*\d/i;
const HEADER = /^[✖✗×]?\s*failing tests:?$/i;
const ASSERTION = /\bassert|\bexpected\b|\breceived\b|!==/i;
const FAILURE =
  /error|fail|✗|✖|×|no such file|not found|cannot|can't|denied|not permitted|unknown option/i;
/**
 * A program's own complaint, as it prints it on stderr: "cat: a.json: No such file or
 * directory", "ls: cannot access 'x'". stdout and stderr reach the app as one text, so this is
 * how a line from stderr is told apart.
 */
const COMPLAINT = /^[\w.-]+: .+: \S/;
/** A listing's lines, which a command prints on success: "total 16", "drwxr-xr-x  3 me  staff". */
const LISTING = /^total \d+$|^[bcdlps-][rwxsStT-]{9}[@+.]?\s/;

/**
 * The line of a failed call's output that says what went wrong. A program's complaint on stderr
 * comes first; then a test's assertion (what it expected and got); then the first line that names
 * an error or failure; then the first line of output. The folder a command ran in, its exit code,
 * stack frames, a listing and a test runner's totals never say what failed. A line that only
 * introduces the next ("Expected values to be strictly equal:") is read together with it.
 */
export function firstErrorLine(item: AgentItem): string {
  const cwd = item.presentation?.cwd?.trim();
  const lines = item.detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== cwd && !EXIT_LINE.test(line));
  const useful = lines.filter(
    (line) => !TALLY.test(line) && !HEADER.test(line) && !LISTING.test(line) && !/^at\s/.test(line),
  );
  const at = [
    useful.findIndex((line) => COMPLAINT.test(line) && FAILURE.test(line)),
    useful.findIndex((line) => ASSERTION.test(line)),
    useful.findIndex((line) => FAILURE.test(line)),
  ].find((index) => index >= 0);
  if (at === undefined) return useful[0] ?? lines.find((line) => !LISTING.test(line)) ?? "";
  const line = useful[at] ?? "";
  const next = useful[at + 1];
  if (!line.endsWith(":") || !next) return line;
  // Node's "AssertionError [ERR_ASSERTION]: " only names the kind; what follows says what failed.
  return `${line.replace(/^AssertionError(?: \[\w+\])?: /, "")} ${next}`;
}

/** A command's first line, with "…" when more follow (a heredoc, a script): the rest is in its details. */
export function commandLine(command: string): string {
  const [first = "", ...rest] = command.trim().split("\n");
  return rest.length ? `${first.trimEnd()} …` : first;
}
