import { mentionSegments, splitSupervisorReferences } from "@/supervisor/reference-text";
import { WatchedApproval } from "@/supervisor/quick-approval";
import { MessageAttachments } from "./attachment-preview";
import { memo, useContext } from "react";
import { FileLinkContext } from "@/files/context";
import { formatDuration } from "./duration";
import { extractToolCallFilePath } from "./paseo/extract-tool-call-file-path";
import { useState } from "react";
import { Check, ChevronRight, FileCode, GitFork, Terminal, Wrench, XCircle } from "lucide-react";
import { AgentMarkdown, CopyButton } from "./markdown";
import { PlanProgress } from "./plan-progress";
import { SubAgentCard } from "./sub-agent-card";
import { BrailleSpinner, Elapsed } from "./activity";
import { Collapse } from "./collapse";
import { OverlayScroll } from "./overlay-scrollbar";
import { Brain, Eye, Globe, Search, Pencil } from "lucide-react";
import { resolveToolCallIconName } from "./paseo/tool-call-icon-name";
import type { AgentItem } from "@concors/protocol";
import { buildToolCallDisplayModel } from "./paseo/tool-call-display";
import type { ToolCallDetail } from "./paseo/agent-types";
import { hasMeaningfulToolCallDetail } from "./paseo/tool-call-detail-state";
import { thinkingExpandable, thinkingPreview, thinkingText } from "./thinking";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import type { TimelineEntry } from "./thinking";
import { commandSummary, toolDisplayName, toolSummary } from "./tool-label";
import {
  commandLine,
  diffStat,
  exitCode,
  firstErrorLine,
  stepKind,
  stepSummary,
  type StepKind,
} from "./step-groups";

/** Memoized: merges keep unchanged items' identity, so a streamed delta re-renders one row
 * instead of re-parsing every message's Markdown while the user scrolls. */
export const TimelineItem = memo(function TimelineItem({
  item,
  workedFor,
  live,
  onFork,
}: {
  item: TimelineEntry;
  workedFor?: string | undefined;
  /** Whether the item's turn is still in progress; a finished turn has nothing left running. */
  live: boolean;
  /** Set on a turn's last reply when the chat can be forked from there. */
  onFork?: ((turnId: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const data = item.presentation;
  const running = live && item.status === "running";
  if (item.steps) return <StepGroup item={item} steps={item.steps} />;
  if (item.quiet) return <StepRow item={item} />;
  if (item.group) return <ToolGroup first={item} items={item.group} live={live} />;
  if (item.kind === "user" || item.kind === "assistant") {
    const message = item.kind === "user" ? splitSupervisorReferences(item.text) : null;
    return (
      <article
        className={
          item.kind === "user"
            ? "mobile-user-bubble ml-auto max-w-[90%] rounded-2xl bg-raised-fill px-4 py-3"
            : "py-1"
        }
      >
        {item.kind === "user" && item.origin && (
          <p className="mb-1 text-xs text-muted-foreground">From Supervisor</p>
        )}
        {item.kind === "user" && <MessageAttachments item={item} className="mb-2" />}
        <div className="chat-markdown break-words">
          {item.kind === "user" ? (
            <p className="whitespace-pre-wrap">
              {/* Mentions read as written, set off by weight; their IDs travel with the message. */}
              {mentionSegments(message?.text ?? "", message?.references ?? []).map((part, index) =>
                part.mention ? (
                  <span key={index} className="font-medium" data-mention>
                    {part.text}
                  </span>
                ) : (
                  part.text
                ),
              )}
            </p>
          ) : (
            <AgentMarkdown item={item}>{item.text}</AgentMarkdown>
          )}
        </div>
        {item.kind === "assistant" && !running && (
          <div className="mt-2 flex items-center gap-2">
            <CopyButton text={item.text} />
            {onFork && (
              <SidebarTooltip place="above" content="Fork from here">
                <button
                  type="button"
                  aria-label="Fork from here"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onFork(item.turnId)}
                >
                  <GitFork className="size-3.5" />
                </button>
              </SidebarTooltip>
            )}
            {workedFor && (
              <span className="text-xs text-muted-foreground">Worked for {workedFor}</span>
            )}
          </div>
        )}
      </article>
    );
  }
  if (data?.type === "plan" || item.kind === "plan") return <PlanProgress item={item} />;
  if (data?.type === "thinking") return <Thinking item={item} running={running} />;
  if (data?.type === "sub_agent") return <SubAgentCard item={item} running={running} />;
  if (item.kind === "system" && item.origin)
    return (
      <article className="text-sm text-muted-foreground">
        <AgentMarkdown>{item.text}</AgentMarkdown>
        {/* Only a report of a request still open can be answered; the rest never look it up. */}
        {item.title === "Agent needs your input" && item.id.startsWith("supervisor-watch:") && (
          <WatchedApproval itemId={item.id} />
        )}
      </article>
    );
  if (item.kind === "system")
    return (
      <article className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {item.id === `turn:${item.turnId}` &&
          item.status === "completed" &&
          /^\d+s$/.test(item.text)
            ? `Worked for ${formatDuration(Number(item.text.slice(0, -1)))}`
            : `${item.title}${item.text ? `: ${item.text}` : ""}`}
        </span>
      </article>
    );
  const detail = toolDetail(item);
  const display = buildToolCallDisplayModel({
    name: toolDisplayName(item.title),
    status:
      item.status === "interrupted"
        ? "canceled"
        : item.status === "running" && !running
          ? "completed"
          : item.status,
    error: item.status === "failed" ? item.detail : null,
    detail,
  });
  const iconName = resolveToolCallIconName(item.title, detail);
  const Icon =
    data?.type === "search"
      ? Search
      : iconName === "eye"
        ? Eye
        : iconName === "pencil"
          ? Pencil
          : iconName === "globe"
            ? Globe
            : data?.type === "shell"
              ? Terminal
              : data?.type === "files"
                ? FileCode
                : Wrench;
  const hasDetails = hasMeaningfulToolCallDetail(detail);
  return (
    <article
      data-tool-status={item.status}
      aria-busy={running}
      className="overflow-hidden rounded-xl border border-transparent bg-muted/50"
      aria-label="Tool call"
    >
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {running ? (
          <BrailleSpinner />
        ) : item.status === "failed" ? (
          <XCircle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={`shrink-0 text-sm font-medium ${running ? "agent-shimmer" : ""}`}>
          {display.displayName}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm text-muted-foreground ${running ? "agent-shimmer" : ""}`}
        >
          {detail.type === "shell"
            ? commandSummary(detail.command)
            : (display.summary ?? toolSummary(item))}
        </span>
        {item.status === "failed" || item.status === "interrupted" ? (
          <span className="text-xs text-muted-foreground">{item.status}</span>
        ) : null}
        {hasDetails && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {open && (
        <OverlayScroll className="chat-scroll max-h-96 overflow-auto border-t p-4 text-ui leading-6">
          <ToolOutput item={item} running={running} />
        </OverlayScroll>
      )}
    </article>
  );
});

/** What a tool call ran on, in the shape the shared display helpers read. */
function toolDetail(item: AgentItem): ToolCallDetail {
  const data = item.presentation;
  if (data?.type === "shell")
    return { type: "shell", command: data.command ?? item.text, output: item.detail };
  if (data?.type === "files")
    return data.fileOperation === "read"
      ? { type: "read", filePath: data.files?.[0]?.path ?? item.text, content: item.detail }
      : { type: "edit", filePath: data.files?.[0]?.path ?? "Files", unifiedDiff: item.detail };
  if (data?.type === "search") return { type: "search", query: item.text };
  return { type: "unknown", input: item.text, output: item.detail };
}

/** A tool call's opened details: its output, diff or arguments, with a way to copy them. */
function ToolOutput({ item, running }: { item: AgentItem; running: boolean }) {
  const openFile = useContext(FileLinkContext);
  const data = item.presentation;
  const filePath = extractToolCallFilePath(toolDetail(item));
  return (
    <>
      <div className="mb-2 flex justify-end">
        <CopyButton text={item.detail || item.text} label="Copy tool output" />
      </div>
      {filePath && (
        <button
          type="button"
          className="mb-2 block max-w-full truncate font-mono text-muted-foreground hover:underline"
          onClick={() => openFile?.(filePath)?.()}
        >
          {filePath}
        </button>
      )}
      {data?.type === "files" && data.fileOperation === "read" ? (
        <pre className="font-mono break-words whitespace-pre-wrap">
          {item.detail || (running ? "Reading file…" : "No file content returned.")}
        </pre>
      ) : data?.type === "files" && data.files?.length ? (
        data.files.map((file) => (
          <div key={file.path} className="mb-3">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-mono font-medium hover:underline"
                onClick={() => openFile?.(file.path)?.()}
              >
                {file.path}
              </button>
              <CopyButton label="Copy diff" text={file.diff} />
            </div>
            {!file.diff && (
              <pre className="font-mono break-words whitespace-pre-wrap">
                {item.detail || "No diff returned."}
              </pre>
            )}
            <pre className="overflow-x-auto font-mono">
              {file.diff.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+")
                      ? "bg-emerald-500/10 text-emerald-600"
                      : line.startsWith("-")
                        ? "bg-red-500/10 text-red-500"
                        : ""
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          </div>
        ))
      ) : data?.type === "mcp" ? (
        <div className="space-y-4">
          <section>
            <h4 className="mb-1 font-medium">Input</h4>
            <pre className="break-words whitespace-pre-wrap">{data.input || "No arguments"}</pre>
          </section>
          <section>
            <h4 className="mb-1 font-medium">{item.status === "failed" ? "Error" : "Result"}</h4>
            <pre className="break-words whitespace-pre-wrap">
              {data.output || (running ? "Waiting for result…" : "No output")}
            </pre>
          </section>
        </div>
      ) : (
        <pre className="font-mono break-words whitespace-pre-wrap">
          {item.detail || item.text || "Waiting for tool output…"}
        </pre>
      )}
      {data?.type === "shell" && data.exitCode !== null && data.exitCode !== undefined && (
        <p className="mt-2 text-muted-foreground">Exit code {data.exitCode}</p>
      )}
    </>
  );
}

const STEP_ICONS: Record<StepKind, typeof Terminal> = {
  tool: Wrench,
  command: Terminal,
  read: Eye,
  edit: Pencil,
  search: Search,
  web: Globe,
  thinking: Brain,
};

const STEP_VERBS: Record<StepKind, string> = {
  tool: "Used",
  command: "Ran",
  read: "Read",
  edit: "Edited",
  search: "Searched for",
  web: "Searched the web for",
  thinking: "Thought",
};

/** The same, for a step still running. */
const LIVE_VERBS: Record<StepKind, string> = {
  tool: "Using",
  command: "Running",
  read: "Reading",
  edit: "Editing",
  search: "Searching for",
  web: "Searching the web for",
  thinking: "Thinking",
};

/** What a step acted on: the command as run, the file, the query, or the tool's name. */
function stepTarget(item: AgentItem, kind: StepKind): string {
  if (kind === "command")
    return commandLine(commandSummary(item.presentation?.command ?? item.text));
  if (kind === "read" || kind === "edit") {
    const files = item.presentation?.files ?? [];
    if (files.length > 1) return `${files[0]?.path} and ${files.length - 1} more`;
    return files[0]?.path ?? item.text;
  }
  if (kind === "tool") return toolDisplayName(item.title);
  return item.text;
}

/**
 * One step of a finished turn as a line of text, not a card: icon and verb in muted ink, what it
 * acted on in normal ink, and a chevron to today's details. A failed step also shows its exit
 * code and the line that says what went wrong, since it is shown outside any summary.
 */
function StepRow({ item }: { item: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const kind = stepKind(item) ?? "tool";
  const Icon = STEP_ICONS[kind];
  const failed = item.status === "failed";
  const running = item.status === "running";
  const hasDetails = hasMeaningfulToolCallDetail(toolDetail(item));
  const stat =
    kind === "edit"
      ? (item.presentation?.files ?? []).reduce(
          (sum, file) => {
            const { added, removed } = diffStat(file.diff);
            return { added: sum.added + added, removed: sum.removed + removed };
          },
          { added: 0, removed: 0 },
        )
      : null;
  const code = failed ? exitCode(item) : undefined;
  const error = failed ? firstErrorLine(item) : "";
  const extra = kind === "tool" ? toolSummary(item) : "";
  return (
    <article aria-label="Tool call" data-tool-status={item.status} className="text-sm">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasDetails ? open : undefined}
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left"
      >
        {failed ? (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={`shrink-0 text-muted-foreground ${running ? "agent-shimmer" : ""}`}>
          {(running ? LIVE_VERBS : STEP_VERBS)[kind]}
        </span>
        <span
          className={`min-w-0 truncate ${kind === "command" ? "font-mono text-ui" : ""} ${running ? "agent-shimmer" : ""}`}
        >
          {stepTarget(item, kind)}
        </span>
        {extra && <span className="min-w-0 truncate text-muted-foreground">{extra}</span>}
        {item.approval && (
          <span className="shrink-0 text-xs text-muted-foreground">{item.approval}</span>
        )}
        {stat && (stat.added > 0 || stat.removed > 0) && (
          <span className="shrink-0 text-xs tabular-nums">
            <span className="text-emerald-600">+{stat.added}</span>{" "}
            <span className="text-red-500">−{stat.removed}</span>
          </span>
        )}
        {failed && (
          <span className="shrink-0 text-xs text-destructive">
            {code === undefined ? "Failed" : `Exit code ${code}`}
          </span>
        )}
        {item.status === "interrupted" && (
          <span className="shrink-0 text-xs text-muted-foreground">Stopped</span>
        )}
        {hasDetails && (
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {error && (
        <p className="ml-[22px] truncate font-mono text-xs text-muted-foreground">{error}</p>
      )}
      <Collapse open={open}>
        <div className="pt-1 pb-2">
          <OverlayScroll className="chat-scroll max-h-96 overflow-auto rounded-lg border p-4 text-ui leading-6">
            <ToolOutput item={item} running={running} />
          </OverlayScroll>
        </div>
      </Collapse>
    </article>
  );
}

/**
 * What the turn in progress is doing now, as one line: the step it is on in the present tense
 * ("Running pnpm test"), or what it waits for, with the turn's time. It takes the place of the
 * step's own row, which joins its run's summary once it is done, and opens to the step's output.
 */
export function LiveLine({
  step,
  waiting,
  startedAt,
}: {
  step?: AgentItem | undefined;
  /** Set while the turn waits on the user: what the line says instead of the step. */
  waiting?: string | undefined;
  startedAt?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const kind = step && stepKind(step);
  const hasDetails = !!step && !waiting && hasMeaningfulToolCallDetail(toolDetail(step));
  return (
    <div role="status" data-live-line className="text-sm">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasDetails ? open : undefined}
        className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-muted-foreground"
      >
        <BrailleSpinner />
        <span className="agent-shimmer min-w-0 truncate">
          {waiting ?? (kind ? LIVE_VERBS[kind] : "Working…")}
          {!waiting && kind && kind !== "thinking" && (
            <>
              {" "}
              <span className={`text-foreground ${kind === "command" ? "font-mono text-ui" : ""}`}>
                {stepTarget(step, kind)}
              </span>
            </>
          )}
        </span>
        <Elapsed startedAt={startedAt} />
        {hasDetails && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {step && (
        <Collapse open={open}>
          <div className="pt-1 pb-2">
            <OverlayScroll className="chat-scroll max-h-96 overflow-auto rounded-lg border p-4 text-ui leading-6">
              <ToolOutput item={step} running />
            </OverlayScroll>
          </div>
        </Collapse>
      )}
    </div>
  );
}

/**
 * A finished turn's run of quiet steps as one muted line: "Ran 2 commands and edited 1 file".
 * Opening it lists each step under a thin rule, with the reasoning between them as it reads on
 * its own. It keeps its first step's id, so an opened group stays open as the chat updates.
 */
function StepGroup({ item, steps }: { item: AgentItem; steps: TimelineEntry[] }) {
  const [open, setOpen] = useState(false);
  // A run the turn in progress is still on has no ✓ yet, and only its finished steps to count.
  const running = item.status === "running";
  return (
    <article aria-label="Tool calls" data-tool-status={item.status} className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-2 py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate">
          {stepSummary(running ? steps.filter((step) => step.status !== "running") : steps)}
        </span>
        {item.status === "interrupted" ? (
          <span className="shrink-0 text-xs">Stopped</span>
        ) : (
          !running && <Check className="size-3.5 shrink-0" aria-label="Done" />
        )}
        <ChevronRight
          className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
      </button>
      <Collapse open={open}>
        <div className="pt-1">
          <div data-collapse-rows className="ml-[7px] space-y-1 border-l pl-4">
            {steps.map((step) =>
              stepKind(step) === "thinking" ? (
                <Thinking key={step.id} item={step} running={step.status === "running"} />
              ) : (
                <StepRow key={step.id} item={step} />
              ),
            )}
          </div>
        </div>
      </Collapse>
    </article>
  );
}

/**
 * A run of the same tool called back to back, as one row: its name, how many calls, and the
 * latest one's summary. Opening it lists the calls, each its usual row.
 */
function ToolGroup({
  first,
  items,
  live,
}: {
  first: AgentItem;
  items: AgentItem[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const latest = items.at(-1) ?? first;
  const running = live && items.some((item) => item.status === "running");
  const failed = items.filter((item) => item.status === "failed").length;
  const read = first.presentation?.type === "files";
  const Icon = first.presentation?.type === "search" ? Search : read ? Eye : Wrench;
  return (
    <article
      aria-label="Tool calls"
      aria-busy={running}
      className="overflow-hidden rounded-xl border border-transparent bg-muted/50"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {running ? <BrailleSpinner /> : <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className={`shrink-0 text-sm font-medium ${running ? "agent-shimmer" : ""}`}>
          {read ? "Read" : toolDisplayName(first.title)}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {items.length} {read ? "files" : "calls"}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm text-muted-foreground ${running ? "agent-shimmer" : ""}`}
        >
          {open || !toolSummary(latest) ? "" : `· ${toolSummary(latest)}`}
        </span>
        {failed > 0 && <span className="text-xs text-muted-foreground">{failed} failed</span>}
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t p-1.5">
          {items.map((item) => (
            <TimelineItem key={item.id} item={item} live={live} />
          ))}
        </div>
      )}
    </article>
  );
}

/** Reasoning is context, not output: one quiet line that opens to the full summary. */
function Thinking({ item, running }: { item: AgentItem; running: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = thinkingPreview(item.text);
  const expandable = thinkingExpandable(item.text);
  return (
    <article
      aria-label="Thinking summary"
      aria-busy={running}
      data-tool-status={item.status}
      className="agent-thinking text-sm text-muted-foreground"
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className="flex max-w-full items-center gap-2 py-0.5 text-left transition-colors enabled:hover:text-foreground"
      >
        <Brain className="size-3.5 shrink-0" />
        <span className={`shrink-0 ${running ? "agent-shimmer" : ""}`}>
          {running ? "Thinking" : "Thought"}
        </span>
        {!open && preview && <span className="min-w-0 truncate opacity-75">{preview}</span>}
        {expandable && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {open && expandable && (
        <div className="mt-1 ml-[7px] border-l pl-4">
          <AgentMarkdown>{thinkingText(item.text)}</AgentMarkdown>
        </div>
      )}
    </article>
  );
}
