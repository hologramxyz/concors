import { mentionSegments, splitSupervisorReferences } from "@/supervisor/reference-text";
import { WatchedApproval } from "@/supervisor/quick-approval";
import { answeredNotice, type AnsweredNotice } from "@/supervisor/answered-notice";
import { SupervisorReferences, type SupervisorReference } from "@/supervisor/reference-context";
import { SessionLinkContext } from "@/supervisor/session-link";
import { MessageAttachments } from "./attachment-preview";
import { memo, useContext, useId, useLayoutEffect, useRef, type RefObject } from "react";
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
import { useShortPath } from "./short-path";
import {
  commandLine,
  diffStat,
  exitCode,
  firstErrorLine,
  shellOutput,
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
  // A tool card's summary line, to tell when its command is cut off (set only for a tool card).
  const summary = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(summary, open);
  const data = item.presentation;
  const running = live && item.status === "running";
  if (item.steps) return <StepGroup item={item} steps={item.steps} />;
  if (item.quiet) return <StepRow item={item} live={live} />;
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
  if (item.answered) return <AnsweredGroup items={item.answered} />;
  if (item.kind === "system" && item.origin) return <SupervisorNotice item={item} />;
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
          ref={summary}
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
        <StepDetails
          item={item}
          running={running}
          shown={detail.type === "shell" ? commandSummary(detail.command) : null}
          cut={cut}
          className="border-t"
        />
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

/**
 * Whether a one-line element's text is cut off with an ellipsis, checked while `active` (a step's
 * details are open) and again whenever the element is resized.
 */
function useCutOff(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const check = () => setCut(element.scrollWidth > element.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active]);
  return cut;
}

/**
 * A step's opened details in a panel that hugs them, with one copy button floating in its top
 * corner, shown on hover or focus like the app's other row actions. When the step's line did not
 * show its whole command (cut off at the edge, its `cd` dropped, or only its first line), the
 * command leads the panel.
 */
function StepDetails({
  item,
  running,
  shown,
  cut,
  className,
}: {
  item: AgentItem;
  running: boolean;
  /** The command as the step's line shows it; null when the step is not a command. */
  shown: string | null;
  /** Whether the step's line is cut off with an ellipsis. */
  cut: boolean;
  /** The panel's frame: a border all round in a list of steps, or above it under a card. */
  className: string;
}) {
  const data = item.presentation;
  const command = (data?.command ?? item.text).trim();
  const diff =
    data?.type === "files" && data.fileOperation !== "read"
      ? (data.files ?? []).map((file) => file.diff).filter(Boolean)
      : [];
  return (
    <div className="group/details relative">
      <OverlayScroll
        className={`chat-scroll max-h-96 overflow-auto p-4 text-ui leading-6 ${className}`}
      >
        {shown !== null && (cut || shown !== command) && (
          <pre className="mb-2 font-mono break-words whitespace-pre-wrap text-muted-foreground">
            {command}
          </pre>
        )}
        <ToolOutput item={item} running={running} />
      </OverlayScroll>
      <div className="absolute top-2 right-2 rounded-md bg-background opacity-0 transition-opacity group-focus-within/details:opacity-100 group-hover/details:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
        {diff.length ? (
          <CopyButton label="Copy diff" text={diff.join("\n")} />
        ) : (
          <CopyButton label="Copy tool output" text={item.detail || item.text} />
        )}
      </div>
    </div>
  );
}

/**
 * A tool call's opened details: its output, diff or arguments. The step's line above already
 * says what it ran on and how it ended, so an edit's single file and a command's exit code are
 * not repeated here; an edit of several files names each above its diff.
 */
function ToolOutput({ item, running }: { item: AgentItem; running: boolean }) {
  const openFile = useContext(FileLinkContext);
  const short = useShortPath();
  const data = item.presentation;
  const filePath =
    data?.type === "files" && data.fileOperation !== "read"
      ? null
      : extractToolCallFilePath(toolDetail(item));
  const files = data?.type === "files" ? (data.files ?? []) : [];
  return (
    <>
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
      ) : files.length ? (
        <div className="space-y-3">
          {files.map((file) => (
            <div key={file.path}>
              {files.length > 1 && (
                <div className="mb-2 flex min-w-0 font-mono font-medium">
                  <FilePathLink path={file.path} label={short(file.path)} />
                </div>
              )}
              {file.diff ? (
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
              ) : (
                <pre className="font-mono break-words whitespace-pre-wrap">
                  {item.detail || "No diff returned."}
                </pre>
              )}
            </div>
          ))}
        </div>
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
          {(data?.type === "shell" ? shellOutput(item.detail) : item.detail) ||
            item.text ||
            "Waiting for tool output…"}
        </pre>
      )}
    </>
  );
}

const STEP_ICONS: Record<StepKind, typeof Terminal> = {
  tool: Wrench,
  command: Terminal,
  read: Eye,
  create: Pencil,
  edit: Pencil,
  search: Search,
  web: Globe,
  thinking: Brain,
};

const STEP_VERBS: Record<StepKind, string> = {
  tool: "Used",
  command: "Ran",
  read: "Read",
  create: "Created",
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
  create: "Creating",
  edit: "Editing",
  search: "Searching for",
  web: "Searching the web for",
  thinking: "Thinking",
};

/**
 * What a step acted on: the command as run, the file, the query, or the tool's name. A file is
 * written as `short` writes it (see `useShortPath`).
 */
function stepTarget(
  item: AgentItem,
  kind: StepKind,
  short: (path: string) => string = (path) => path,
): string {
  if (kind === "command")
    return commandLine(commandSummary(item.presentation?.command ?? item.text));
  if (kind === "read" || kind === "edit" || kind === "create") {
    const files = item.presentation?.files ?? [];
    if (files.length > 1) return `${short(files[0]?.path ?? "")} and ${files.length - 1} more`;
    return short(files[0]?.path ?? item.text);
  }
  if (kind === "tool") return toolDisplayName(item.title);
  return item.text;
}

/** A file step's paths in full, one a line, for the tooltip of its shortened target. */
function stepPaths(item: AgentItem, kind: StepKind): string | undefined {
  if (kind !== "read" && kind !== "edit" && kind !== "create") return undefined;
  const files = item.presentation?.files ?? [];
  return files.length ? files.map((file) => file.path).join("\n") : item.text;
}

/**
 * A path a step row can open: in the row's own ink, so a list of steps stays quiet, and
 * underlined only under the pointer or keyboard focus, as the path inside a step's details was.
 */
const FILE_LINK = "cursor-pointer hover:underline focus-visible:underline";

/**
 * A file a step touched, opening as a file link in a chat message does, through the same handler
 * and with its full path. One the chat cannot open (outside the workspace) reads as such a link
 * does there: dotted, and saying so, but not clickable.
 */
function FilePathLink({ path, label }: { path: string; label: string }) {
  const openFile = useContext(FileLinkContext);
  const open = openFile?.(path) ?? null;
  if (!open)
    return (
      <span
        className="min-w-0 truncate underline decoration-dotted underline-offset-2"
        title={`Outside this project: ${path}`}
      >
        {label}
      </span>
    );
  return (
    <button
      type="button"
      title={path}
      onClick={open}
      // Above a row's own toggle, which lies under the whole line.
      className={`relative min-w-0 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${FILE_LINK}`}
    >
      {label}
    </button>
  );
}

/**
 * One step of a finished turn as a line of text, not a card: icon and verb in muted ink, what it
 * acted on in normal ink, and a chevron to today's details. A failed step also shows its exit
 * code and the line that says what went wrong, since it is shown outside any summary.
 */
function StepRow({ item, live }: { item: TimelineEntry; live: boolean }) {
  const [open, setOpen] = useState(false);
  const kind = stepKind(item) ?? "tool";
  const Icon = STEP_ICONS[kind];
  const short = useShortPath();
  const failed = item.status === "failed";
  // Running only while its turn is: a finished turn has nothing left running, even when the
  // client's copy of a call never heard it end (it would read "Editing" for good).
  const running = live && item.status === "running";
  const hasDetails = hasMeaningfulToolCallDetail(toolDetail(item));
  const stat =
    kind === "edit" || kind === "create"
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
  const target = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(target, open);
  const openFile = useContext(FileLinkContext);
  const id = useId();
  // An edit's file opens from its row once the step is done, as a file link in the chat does.
  const files = kind === "edit" || kind === "create" ? (item.presentation?.files ?? []) : [];
  const file = !running ? files[0]?.path : undefined;
  const opens = !!file && !!openFile?.(file);
  const more = files.length > 1 && (
    <span className="shrink-0" title={stepPaths(item, kind)}>
      {` and ${files.length - 1} more`}
    </span>
  );
  const lead = (
    <>
      {failed ? (
        <XCircle className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={`shrink-0 text-muted-foreground ${running ? "agent-shimmer" : ""}`}>
        {(running ? LIVE_VERBS : STEP_VERBS)[kind]}
      </span>
    </>
  );
  const rest = (
    <>
      {extra && <span className="min-w-0 truncate text-muted-foreground">{extra}</span>}
      {item.approval && (
        <span className="shrink-0 text-xs text-muted-foreground">{item.approval}</span>
      )}
      {/* A side with nothing to count is left out: a new file reads "+4", not "+4 −0". */}
      {stat && (stat.added > 0 || stat.removed > 0) && (
        <span className="flex shrink-0 gap-1 text-xs tabular-nums">
          {stat.added > 0 && <span className="text-emerald-600">+{stat.added}</span>}
          {stat.removed > 0 && <span className="text-red-500">−{stat.removed}</span>}
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
    </>
  );
  return (
    <article aria-label="Tool call" data-tool-status={item.status} className="text-sm">
      {file && opens ? (
        // A button cannot hold another, so the row's toggle lies under the whole line and the
        // path sits above it: a click on the path opens the file, anywhere else opens the step.
        // The toggle keeps the line's words as its name; the words beside it are not read twice.
        <div className="relative flex w-full min-w-0 items-center gap-2 py-0.5">
          <button
            type="button"
            disabled={!hasDetails}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={hasDetails ? open : undefined}
            aria-labelledby={`${id}-lead ${id}-path ${id}-rest`}
            className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <span id={`${id}-lead`} aria-hidden className="contents">
            {lead}
          </span>
          <span id={`${id}-path`} className="contents">
            <FilePathLink path={file} label={short(file)} />
            {more}
          </span>
          <span id={`${id}-rest`} aria-hidden className="contents">
            {rest}
          </span>
        </div>
      ) : (
        <button
          type="button"
          disabled={!hasDetails}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={hasDetails ? open : undefined}
          className="flex w-full min-w-0 items-center gap-2 py-0.5 text-left"
        >
          {lead}
          {file ? (
            // Outside the workspace: as a chat message shows a file it cannot open.
            <>
              <FilePathLink path={file} label={short(file)} />
              {more}
            </>
          ) : (
            <span
              ref={target}
              className={`min-w-0 truncate ${kind === "command" ? "font-mono text-ui" : ""} ${running ? "agent-shimmer" : ""}`}
              title={stepPaths(item, kind)}
            >
              {stepTarget(item, kind, short)}
            </span>
          )}
          {rest}
        </button>
      )}
      {error && !open && (
        <p className="ml-[22px] truncate font-mono text-xs text-muted-foreground">{error}</p>
      )}
      <Collapse open={open}>
        <div className="pt-1 pb-2">
          <StepDetails
            item={item}
            running={running}
            shown={kind === "command" ? stepTarget(item, kind) : null}
            cut={cut}
            className="rounded-lg border"
          />
        </div>
      </Collapse>
    </article>
  );
}

/**
 * Supervisor's notice about a chat it watches, as the daemon wrote it. A request answered since
 * reads as one row instead, when its chat and action can be read (see `answeredNotice`).
 */
function SupervisorNotice({ item }: { item: AgentItem }) {
  const references = useContext(SupervisorReferences);
  const notice = answeredNotice(item);
  const chat = notice && answeredChat(references, notice.sessionId);
  if (notice && chat) return <AnsweredRow notice={notice} chat={chat} />;
  return (
    <article className="text-sm text-muted-foreground">
      <AgentMarkdown>{item.text}</AgentMarkdown>
      {/* Only a report of a request still open can be answered; the rest never look it up. */}
      {item.title === "Agent needs your input" && item.id.startsWith("supervisor-watch:") && (
        <WatchedApproval itemId={item.id} />
      )}
    </article>
  );
}

function answeredChat(references: readonly SupervisorReference[], sessionId: string) {
  return references.find((ref) => ref.kind === "Agent" && ref.id === sessionId);
}

/**
 * An answered request as one line, shaped as an answered step ("Ran echo test  Allowed once"):
 * its chat, linked as Supervisor's notice links it, what it asked for, and "Resumed", since the
 * notice does not say how it was answered. A command reads in monospace without the `cd` in
 * front, as a step's does; opening the row shows the action in full when the line cuts it short.
 */
function AnsweredRow({ notice, chat }: { notice: AnsweredNotice; chat: SupervisorReference }) {
  const [open, setOpen] = useState(false);
  const openSession = useContext(SessionLinkContext);
  const { action, command } = notice;
  const line = command ? commandLine(commandSummary(action)) : action;
  const target = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(target, true);
  const expandable = cut || line !== action;
  const Icon = command ? Terminal : Pencil;
  const id = useId();
  return (
    <article aria-label="Answered request" className="text-sm">
      {/* As a step row with a file link: the toggle lies under the whole line, the link above it. */}
      <div className="mobile-tap-target relative flex w-full min-w-0 items-center gap-2 py-0.5">
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expandable ? open : undefined}
          aria-labelledby={`${id}-action ${id}-mark`}
          className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex max-w-1/2 min-w-0 shrink-0 items-center text-muted-foreground">
          {chat.workspace && <span className="min-w-0 truncate">{chat.workspace}</span>}
          {chat.workspace && <span className="shrink-0 whitespace-pre"> / </span>}
          {openSession ? (
            <button
              type="button"
              onClick={() => openSession(notice.sessionId)}
              className="mobile-hit-area text-link relative min-w-0 truncate rounded-sm text-left underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {chat.label}
            </button>
          ) : (
            <span className="min-w-0 truncate">{chat.label}</span>
          )}
        </span>
        <span
          ref={target}
          id={`${id}-action`}
          aria-hidden
          className={`min-w-0 truncate ${command ? "font-mono text-ui" : ""}`}
        >
          {line}
        </span>
        <span id={`${id}-mark`} aria-hidden className="shrink-0 text-xs text-muted-foreground">
          Resumed
        </span>
        {expandable && (
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
      </div>
      <Collapse open={open}>
        <div className="pt-1 pb-2">
          <div className="group/details relative">
            <OverlayScroll className="chat-scroll max-h-96 overflow-auto rounded-lg border p-4 text-ui leading-6">
              <pre
                className={`break-words whitespace-pre-wrap text-muted-foreground ${command ? "font-mono" : "font-sans"}`}
              >
                {action}
              </pre>
            </OverlayScroll>
            <div className="absolute top-2 right-2 rounded-md bg-background opacity-0 transition-opacity group-focus-within/details:opacity-100 group-hover/details:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
              <CopyButton label="Copy quote" text={action} />
            </div>
          </div>
        </div>
      </Collapse>
    </article>
  );
}

/**
 * A run of answered requests as one muted line, "3 approvals answered", folded and opened as a
 * run of steps is. It keeps its first notice's id, so it stays open as more are answered.
 */
function AnsweredGroup({ items }: { items: AgentItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <article aria-label="Answered requests" className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mobile-tap-target flex max-w-full items-center gap-2 py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate">{items.length} approvals answered</span>
        <ChevronRight
          className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
      </button>
      <Collapse open={open}>
        <div className="pt-1">
          <div data-collapse-rows className="ml-[7px] space-y-1 border-l pl-4">
            {items.map((item) => (
              <SupervisorNotice key={item.id} item={item} />
            ))}
          </div>
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
  const short = useShortPath();
  const hasDetails = !!step && !waiting && hasMeaningfulToolCallDetail(toolDetail(step));
  const line = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(line, open);
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
        <span ref={line} className="agent-shimmer min-w-0 truncate">
          {waiting ?? (kind ? LIVE_VERBS[kind] : "Working…")}
          {!waiting && kind && kind !== "thinking" && (
            <>
              {" "}
              <span
                className={`text-foreground ${kind === "command" ? "font-mono text-ui" : ""}`}
                title={stepPaths(step, kind)}
              >
                {stepTarget(step, kind, short)}
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
            <StepDetails
              item={step}
              running
              shown={kind === "command" ? stepTarget(step, kind) : null}
              cut={cut}
              className="rounded-lg border"
            />
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
                <Thinking
                  key={step.id}
                  item={step}
                  running={running && step.status === "running"}
                />
              ) : (
                // A group still running is in the turn in progress; a finished one is not.
                <StepRow key={step.id} item={step} live={running} />
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
          {open ? "" : toolSummary(latest)}
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
