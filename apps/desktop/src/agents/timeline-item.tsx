import { copyChips, mentionSegments, splitSupervisorReferences } from "@/supervisor/reference-text";
import { MentionChip } from "@/supervisor/mention-menu";
import { ApprovalAction, WatchedApproval } from "@/supervisor/quick-approval";
import {
  pendingNotice,
  pendingWord,
  queuedWords,
  type PendingNotice,
} from "@/supervisor/pending-notice";
import { useAgents } from "@/agents/context";
import { chatDot } from "@/agents/agent-status";
import { ProjectImage } from "@/workspace/project-image";
import { WorkspaceImageContext } from "@/workspace/use-project-icons";
import { approvalParts } from "@/agents/approval-summary";
import { approvalDetails, rowDescription, rowReviewView } from "@/agents/approval-details";
import { ApprovalReview, DiffLines } from "@/agents/pending-input";
import { useHomePath } from "@/workspace/home-path";
import { SidebarDot } from "@/workspace/sidebar-tabs";
import { answeredNotice, answeredSummary, type AnsweredNotice } from "@/supervisor/answered-notice";
import {
  finishedNotice,
  finishedWord,
  imagesLine,
  quoteImages,
  type FinishedNotice,
} from "@/supervisor/finished-notice";
import {
  pausedNotice,
  pausedWords,
  waitingWords,
  type PausedNotice,
} from "@/supervisor/paused-notice";
import { Button } from "@/components/ui/button";
import { SupervisorReferences, type SupervisorReference } from "@/supervisor/reference-context";
import { SessionLinkContext } from "@/supervisor/session-link";
import { CompactLayoutContext } from "@/components/compact-layout";
import { MessageAttachments } from "./attachment-preview";
import { memo, useContext, useId, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
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
import type { Voice } from "./live-voice";
import {
  commandSummary,
  controlStep,
  toolDisplayName,
  toolSummary,
  type NameOf,
} from "./tool-label";
import { shortPath, useShortPath } from "./short-path";
import {
  DECLINED,
  commandLine,
  diffStat,
  exitCode,
  firstErrorLine,
  shellOutput,
  stepKind,
  stepSummary,
  stepTarget,
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
  const nameOf = useNameOf();
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
            <p className="whitespace-pre-wrap" onCopy={copyChips}>
              {/* A mention is a chip (see `MentionChip`). A screen reader hears "mention" and the
                  name; a copy reads "@Name" as written. The IDs travel with the message. */}
              {mentionSegments(message?.text ?? "", message?.references ?? []).map(
                (part, index) => {
                  const reference =
                    part.mention &&
                    message?.references.find((ref) => `@${ref.label}` === part.text);
                  return reference ? (
                    <MentionChip
                      key={index}
                      data-mention={reference.label}
                      reference={reference}
                      className="before:sr-only before:content-['mention,_']"
                    >
                      <span aria-hidden="true" className="sr-only">
                        @
                      </span>
                      {reference.label}
                    </MentionChip>
                  ) : (
                    part.text
                  );
                },
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
            : (display.summary ?? toolSummary(item, nameOf))}
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

/**
 * Names for the IDs in Supervisor's own tool calls: its mention list, which holds the chats and
 * workspaces on this machine. Outside Supervisor the list is empty and nothing resolves.
 */
function useNameOf(): NameOf {
  const references = useContext(SupervisorReferences);
  return useMemo(() => {
    const names = new Map(references.map((reference) => [reference.id, reference.label]));
    return (id) => names.get(id);
  }, [references]);
}

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
  /**
   * What the step's line says of its command ("a command", or the command on a card that quotes
   * it); null when the step is not a command. The command is shown in full above the output
   * unless the line already shows all of it.
   */
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
                <DiffLines diff={file.diff} />
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
  // A request the person turned down did not run: the row says so in its verb ("Declined a
  // command"), in the row's quiet ink, and leaves out what only a call that ran has (an exit code,
  // a diff's counts, a file to open). It still opens to what was asked for.
  const declined = item.approval === DECLINED;
  const failed = item.status === "failed" && !declined;
  // Running only while its turn is: a finished turn has nothing left running, even when the
  // client's copy of a call never heard it end (it would read "Editing" for good).
  const running = live && item.status === "running";
  const hasDetails = hasMeaningfulToolCallDetail(toolDetail(item));
  const stat =
    !declined && (kind === "edit" || kind === "create")
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
  const nameOf = useNameOf();
  // Supervisor's own calls read as what they did to which chat, in place of "Used Concors control".
  const control = kind === "tool" ? controlStep(item, nameOf, running) : undefined;
  const extra = kind === "tool" && !control ? toolSummary(item, nameOf) : "";
  const target = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(target, open);
  const openFile = useContext(FileLinkContext);
  const id = useId();
  // An edit's file opens from its row once the step is done, as a file link in the chat does.
  const files = kind === "edit" || kind === "create" ? (item.presentation?.files ?? []) : [];
  const file = !running && !declined ? files[0]?.path : undefined;
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
        {declined ? DECLINED : (control?.verb ?? (running ? LIVE_VERBS : STEP_VERBS)[kind])}
      </span>
    </>
  );
  const rest = (
    <>
      {extra && <span className="min-w-0 truncate text-muted-foreground">{extra}</span>}
      {item.approval && !declined && (
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
      {item.status === "interrupted" && !declined && (
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
              className={`min-w-0 truncate ${kind === "command" ? "text-muted-foreground" : ""} ${running ? "agent-shimmer" : ""}`}
              title={stepPaths(item, kind)}
            >
              {control ? control.target : stepTarget(item, kind, short)}
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
 * Supervisor's notice about a chat it watches, as the daemon wrote it. A request still open, one
 * answered since, a turn that ended, or a paused queue reads as one block or row instead, when its
 * chat and its shape can be read (see `pendingNotice`, `answeredNotice`, `finishedNotice` and
 * `pausedNotice`).
 */
function SupervisorNotice({ item }: { item: TimelineEntry }) {
  const references = useContext(SupervisorReferences);
  const notice = answeredNotice(item);
  const chat = notice && answeredChat(references, notice.sessionId);
  if (notice && chat) return <AnsweredRow notice={notice} chat={chat} />;
  const finished = finishedNotice(item);
  const finishedChat = finished && answeredChat(references, finished.sessionId);
  if (finished && finishedChat)
    return <FinishedRow notice={finished} chat={finishedChat} latest={!item.finishedLater} />;
  const pending = pendingNotice(item);
  const pendingChat = pending && answeredChat(references, pending.sessionId);
  if (pending && pendingChat)
    return <PendingBlock itemId={item.id} notice={pending} chat={pendingChat} />;
  const paused = pausedNotice(item);
  const pausedChat = paused && answeredChat(references, paused.sessionId);
  if (paused && pausedChat)
    return <PausedRow notice={paused} chat={pausedChat} latest={!item.pausedLater} />;
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
 * its chat, linked as Supervisor's notice links it, what it asked for, and "Answered", which holds
 * however it was answered and whether or not the chat carried on. A command reads in monospace
 * without the `cd` in front, as a step's does; a question and a file request read in the normal
 * font. Opening the row shows the action in full when the line cuts it short. The chat's line takes
 * at most half the row; on a phone its workspace is cut first within that (see `NoticeChat`).
 */
function AnsweredRow({ notice, chat }: { notice: AnsweredNotice; chat: SupervisorReference }) {
  const [open, setOpen] = useState(false);
  const { action, command } = notice;
  const line = command ? commandLine(commandSummary(action)) : action;
  const target = useRef<HTMLSpanElement>(null);
  const cut = useCutOff(target, true);
  const expandable = cut || line !== action;
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
        <RowWorkspace sessionId={notice.sessionId} />
        <NoticeChat chat={chat} sessionId={notice.sessionId} className="max-w-1/2 shrink-0" />
        <span
          ref={target}
          id={`${id}-action`}
          aria-hidden
          className={`min-w-0 truncate ${command ? "font-mono text-ui" : ""}`}
        >
          {line}
        </span>
        <span id={`${id}-mark`} aria-hidden className="shrink-0 text-xs text-muted-foreground">
          Answered
        </span>
        {expandable && (
          // Rotated, it would sit above the toggle and take its clicks.
          <ChevronRight
            className={`pointer-events-none size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
      </div>
      <Collapse open={open}>
        <div className="pt-1 pb-2">
          <div className="group/details relative">
            <OverlayScroll className="chat-scroll max-h-96 overflow-auto rounded-lg border p-4 text-ui leading-6">
              {/* Room on the right for the copy button, so the first line wraps before it. */}
              <pre
                className={`pr-7 break-words whitespace-pre-wrap text-muted-foreground ${command ? "font-mono" : "font-sans"}`}
              >
                {action}
              </pre>
            </OverlayScroll>
            <div className="absolute top-2 right-2 rounded-md bg-background opacity-0 transition-opacity group-focus-within/details:opacity-100 group-hover/details:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
              <CopyButton label="Copy" text={action} />
            </div>
          </div>
        </div>
      </Collapse>
    </article>
  );
}

/**
 * The chat a notice is about, as Supervisor's notice links it: "Workspace / Chat", the chat's name
 * opening it.
 *
 * Overview's rows lead with the same line, as `title`, filling the room their line gives it: there
 * the whole row opens the chat, so the name is plain text in the stronger weight, followed by
 * `children` (how the chat ended, what is queued). There, and in a phone's chat rows, the name keeps
 * its width while the workspace gives way first (see `useFittedWorkspace`), so the row still says
 * which workspace the icon before it is.
 */
export function NoticeChat({
  chat,
  sessionId,
  className,
  title = false,
  children,
}: {
  chat: Pick<SupervisorReference, "workspace" | "label">;
  sessionId: string;
  className: string;
  title?: boolean;
  children?: React.ReactNode;
}) {
  const openSession = useContext(SessionLinkContext);
  const compact = useContext(CompactLayoutContext);
  const { line, name, rest, workspace } = useFittedWorkspace(
    chat,
    title || compact,
    title,
    children != null && children !== false,
  );
  // Overview's line is trimmed to its capitals, as the workspace's letter tile is, so the row
  // centres them on the icon rather than the line, whose baseline the font sets a little high. The
  // name's padding keeps descenders inside its clip and leaves its centre where it is.
  const capitals = title ? "[text-box:trim-both_cap_alphabetic]" : "";
  if (title || compact)
    return (
      <span ref={line} className={`flex min-w-0 items-center text-muted-foreground ${className}`}>
        {workspace && (
          <span className={`shrink-0 whitespace-pre ${capitals}`}>
            {workspace}
            {" / "}
          </span>
        )}
        {title ? (
          <span
            ref={name as RefObject<HTMLSpanElement>}
            className={`min-w-0 truncate py-1 font-medium text-sidebar-foreground ${capitals}`}
          >
            {chat.label}
          </span>
        ) : openSession ? (
          <button
            ref={name as RefObject<HTMLButtonElement>}
            type="button"
            onClick={() => openSession(sessionId)}
            className="mobile-hit-area text-link relative min-w-0 truncate rounded-sm text-left underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {chat.label}
          </button>
        ) : (
          <span ref={name as RefObject<HTMLSpanElement>} className="min-w-0 truncate">
            {chat.label}
          </span>
        )}
        {children && (
          <span ref={rest} className="ml-2 flex shrink-0 items-center gap-2">
            {children}
          </span>
        )}
      </span>
    );
  return (
    <span className={`flex min-w-0 items-center text-muted-foreground ${className}`}>
      {chat.workspace && (
        <span className="flex min-w-0 items-center">
          <span className="min-w-0 truncate">{chat.workspace}</span>
          <span className="shrink-0 whitespace-pre"> / </span>
        </span>
      )}
      {openSession ? (
        <button
          type="button"
          onClick={() => openSession(sessionId)}
          className="mobile-hit-area text-link relative min-w-0 truncate rounded-sm text-left underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {chat.label}
        </button>
      ) : (
        <span className="min-w-0 truncate">{chat.label}</span>
      )}
    </span>
  );
}

/**
 * The workspace's name cut to the room its line leaves it beside the whole chat name, with the
 * ellipsis right after the last letter kept. CSS's own ellipsis keeps a trailing space and the
 * unused end of its box, which would widen the gap before " / " only when the name is cut. The room
 * comes from the row, never from the cut text, so cutting cannot change it: Overview's line fills
 * its row (`fills`); a chat row's line is as wide as its text, so its room is the row's width less
 * what else sits there at full width (the icon, the state word), within the line's own max-width. A
 * neighbour that gives way itself, as an answered row's action does, takes none of it. Null when not
 * even one letter fits: the workspace and its slash give way whole.
 */
function useFittedWorkspace(
  chat: Pick<SupervisorReference, "workspace" | "label">,
  active: boolean,
  fills: boolean,
  /** Whether anything follows the name, which the line must also leave room for. */
  followed: boolean,
) {
  const line = useRef<HTMLSpanElement>(null);
  const name = useRef<HTMLElement>(null);
  const rest = useRef<HTMLSpanElement>(null);
  // The cut, with the name it was cut from, so a renamed workspace never shows the old one's cut.
  const [fitted, setFitted] = useState<{ full: string; shown: string | null } | null>(null);
  useLayoutEffect(() => {
    const element = line.current;
    const full = chat.workspace;
    if (!active || !element || !full) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const setWorkspace = (shown: string | null) => setFitted({ full, shown });
    const fit = () => {
      // Built from its parts: the computed shorthand can be empty.
      const style = getComputedStyle(element);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = (text: string) => context.measureText(text).width;
      // A little to spare, as the canvas and the page round text widths apart.
      const room =
        lineWidth(element, fills) -
        (name.current?.scrollWidth ?? 0) -
        (rest.current ? rest.current.offsetWidth + 8 : 0) -
        width(" / ") -
        2;
      if (width(full) <= room) return setWorkspace(full);
      let kept = 0;
      for (let high = full.length - 1; kept < high;) {
        const mid = Math.ceil((kept + high) / 2);
        if (width(`${full.slice(0, mid).trimEnd()}…`) <= room) kept = mid;
        else high = mid - 1;
      }
      const cut = full.slice(0, kept).trimEnd();
      setWorkspace(cut ? `${cut}…` : null);
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const part of [element, element.parentElement, name.current, rest.current])
      if (part) observer.observe(part);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [active, fills, followed, chat.workspace, chat.label]);
  const workspace =
    active && fitted && fitted.full === chat.workspace ? fitted.shown : chat.workspace || null;
  return { line, name, rest, workspace };
}

/** The width a fitted line may take: see `useFittedWorkspace`. */
function lineWidth(line: HTMLElement, fills: boolean) {
  const row = line.parentElement;
  if (fills || !row) return line.clientWidth;
  const style = getComputedStyle(row);
  const others = [...row.children].filter(
    (child) => child !== line && getComputedStyle(child).position !== "absolute",
  );
  let width =
    row.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    (parseFloat(style.columnGap) || 0) * others.length;
  for (const other of others) {
    const own = getComputedStyle(other);
    if (parseFloat(own.flexShrink) > 0 && own.minWidth === "0px") continue;
    width -= other.getBoundingClientRect().width;
  }
  const max = getComputedStyle(line).maxWidth;
  if (max.endsWith("%")) width = Math.min(width, (row.clientWidth * parseFloat(max)) / 100);
  else if (max.endsWith("px")) width = Math.min(width, parseFloat(max));
  return width;
}

/**
 * A row that needs a person: its chat's line, then, in a ruled block under it, the state as the
 * block's first line ("Needs your approval" in stronger ink beside the attention dot, as Overview
 * marks what needs you, or "Failed" in the error colour), what it is about, and what can be done.
 * When the content is cut short, the state line opens it in place, its chevron after the words.
 */
function NeedsBlock({
  label,
  chat,
  sessionId,
  state,
  failed = false,
  toggle,
  children,
}: {
  label: string;
  chat: SupervisorReference;
  sessionId: string;
  state: string;
  failed?: boolean;
  toggle: { open: boolean; onToggle: () => void } | null;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <article aria-label={label} className="text-sm">
      <div className="mobile-tap-target relative flex w-full min-w-0 items-center gap-2 py-0.5">
        <RowWorkspace sessionId={sessionId} />
        <NoticeChat chat={chat} sessionId={sessionId} className="shrink" />
      </div>
      <div className="ml-[7px] min-w-0 border-l pl-4">
        <div className="mobile-tap-target relative flex min-w-0 items-center gap-1.5 py-0.5">
          {toggle && (
            <button
              type="button"
              onClick={toggle.onToggle}
              aria-expanded={toggle.open}
              aria-labelledby={`${id}-mark`}
              className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          )}
          {!failed && <SidebarDot dot="attention" />}
          <span
            id={`${id}-mark`}
            className={`text-xs font-semibold ${failed ? "text-destructive" : "text-foreground"}`}
          >
            {state}
          </span>
          {toggle && (
            // Rotated, it would sit above the toggle and take its clicks.
            <ChevronRight
              className={`pointer-events-none size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${toggle.open ? "rotate-90" : ""}`}
            />
          )}
        </div>
        {children}
      </div>
    </article>
  );
}

/** "Open chat" or "Review queue" under a row that needs a person: it opens the chat, as its name does. */
function OpenChatAction({ sessionId, label }: { sessionId: string; label: string }) {
  const openSession = useContext(SessionLinkContext);
  if (!openSession) return null;
  return (
    <div className="mt-2 flex">
      <Button size="xs" variant="outline" onClick={() => openSession(sessionId)}>
        {label}
      </Button>
    </div>
  );
}

/**
 * A chat's ended turn. "Finished" and "Stopped" are one quiet row: its chat, linked, then how the
 * turn ended in small muted text. A chat's most recent "Failed", while that chat is still failed
 * and unseen (its sidebar dot, see `chatDot`), needs a person, so it reads as a block (see
 * `NeedsBlock`) with "Open chat" under the error. Every other "Failed" is a quiet row too, the word
 * in the error colour, its error folded until the row opens it. The agent's last reply, or the
 * chat's error, sits under the chat as a quiet quote with its line breaks kept and a copy button;
 * past six lines it is clamped, and the row opens it in place. Without a reply a quiet row stands
 * alone, since its link already opens the chat.
 */
function FinishedRow({
  notice,
  chat,
  latest,
}: {
  notice: FinishedNotice;
  chat: SupervisorReference;
  latest: boolean;
}) {
  const agent = useAgents().find((a) => a.id === notice.sessionId);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const quote = useRef<HTMLDivElement>(null);
  // Whether six lines cut the quote short, measured again as the chat or the text changes.
  useLayoutEffect(() => {
    const element = quote.current;
    if (!element || open) return;
    const check = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, notice.quote]);
  const shown = useMemo(
    () => (notice.quote === null ? null : quoteImages(notice.quote)),
    [notice.quote],
  );
  const failed = notice.state === "failed";
  const needed = failed && latest && agent?.status === "failed" && chatDot(agent) === "attention";
  // A failure dealt with keeps its error out of sight until asked for.
  const folded = failed && !needed;
  const expandable = folded ? notice.quote !== null : clamped || open;
  const word = finishedWord(notice.state);
  const id = useId();
  const body = notice.quote !== null && (!folded || open) && (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1 py-0.5 text-muted-foreground">
        {/* Each line as the agent wrote it: Markdown would run a quote's lines together. */}
        {shown?.text && (
          <div
            ref={quote}
            data-finished-quote
            className={`[&_p]:whitespace-pre-line ${open ? "" : "line-clamp-6"}`}
          >
            <AgentMarkdown>{shown.text}</AgentMarkdown>
          </div>
        )}
        {/* Images stay in the chat, which the row links to: counted here, never shown missing. */}
        {!!shown?.images && (
          <p className={shown.text ? "mt-2" : undefined}>{imagesLine(shown.images)}</p>
        )}
        {notice.cut && <p className="mt-2">Read the original chat for the full reply.</p>}
      </div>
      <CopyButton label="Copy quote" text={notice.quote} />
    </div>
  );
  if (needed)
    return (
      <NeedsBlock
        label={`${chat.label} failed`}
        chat={chat}
        sessionId={notice.sessionId}
        state={word}
        failed
        toggle={expandable ? { open, onToggle: () => setOpen((v) => !v) } : null}
      >
        {body}
        <OpenChatAction sessionId={notice.sessionId} label="Open chat" />
      </NeedsBlock>
    );
  return (
    <article aria-label={`${chat.label} ${word.toLowerCase()}`} className="text-sm">
      <div className="mobile-tap-target relative flex w-full min-w-0 items-center gap-2 py-0.5">
        {expandable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-labelledby={`${id}-mark`}
            className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        )}
        <RowWorkspace sessionId={notice.sessionId} />
        <NoticeChat chat={chat} sessionId={notice.sessionId} className="shrink" />
        <span
          id={`${id}-mark`}
          className={`shrink-0 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
        >
          {word}
        </span>
        {expandable && (
          // Rotated, it would sit above the toggle and take its clicks.
          <ChevronRight
            className={`pointer-events-none size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
      </div>
      {body && <div className="ml-[7px] min-w-0 border-l pl-4">{body}</div>}
    </article>
  );
}

/**
 * A chat's paused queue. A chat's most recent paused notice, while the app still holds that
 * chat's queue paused with something in it, needs a person: a block (see `NeedsBlock`) reading
 * "Queue paused", then how many instructions wait in normal ink, the chat's error muted when the
 * daemon gave one, and "Review queue", which opens the chat where the queue is resumed. Every
 * other paused notice, and this one once the queue is resumed or emptied, is one quiet row: its
 * chat, linked, then "1 instruction paused" (or "Queue paused" when the daemon's number cannot be
 * read) in small muted text.
 */
function PausedRow({
  notice,
  chat,
  latest,
}: {
  notice: PausedNotice;
  chat: SupervisorReference;
  latest: boolean;
}) {
  const agent = useAgents().find((a) => a.id === notice.sessionId);
  if (latest && agent?.queuePaused && agent.queue?.length) {
    return (
      <NeedsBlock
        label={`${chat.label} queue paused`}
        chat={chat}
        sessionId={notice.sessionId}
        state="Queue paused"
        toggle={null}
      >
        {notice.count !== null && (
          <p className="py-0.5 leading-5 text-foreground">{waitingWords(notice.count)}</p>
        )}
        {notice.error && (
          <p className="py-0.5 leading-5 break-words whitespace-pre-line text-muted-foreground">
            {notice.error}
          </p>
        )}
        <OpenChatAction sessionId={notice.sessionId} label="Review queue" />
      </NeedsBlock>
    );
  }
  const word = pausedWords(notice.count);
  return (
    <article aria-label={`${chat.label} ${word.toLowerCase()}`} className="text-sm">
      <div className="mobile-tap-target relative flex w-full min-w-0 items-center gap-2 py-0.5">
        <RowWorkspace sessionId={notice.sessionId} />
        <NoticeChat chat={chat} sessionId={notice.sessionId} className="shrink" />
        <span className="shrink-0 text-xs text-muted-foreground">{word}</span>
      </div>
    </article>
  );
}

/**
 * The workspace a notice's chat is in, by the image the sidebar gives that workspace (see
 * `ProjectImage`), since the row names it first: "Workspace / Chat". A chat the app no longer
 * lists, or a workspace it does not know, shows the plain folder, so every row lines up.
 */
export function RowWorkspace({ sessionId }: { sessionId: string }) {
  const agent = useAgents().find((a) => a.id === sessionId);
  const image = useContext(WorkspaceImageContext)(agent?.projectId ?? "");
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground opacity-80">
      <ProjectImage
        key={image?.source ?? "fallback"}
        source={image?.source ?? null}
        isGit={image?.isGit ?? false}
        name={image?.name ?? ""}
        size={14}
      />
    </span>
  );
}

/**
 * A request a chat is waiting on, as a block (see `NeedsBlock`): "Needs your approval" or "Needs
 * your answer", then, above a command, what Claude Code says it is for, as the approval card has it,
 * then what the request is for in normal ink as Overview's approval line reads it (a
 * command in monospace, a file request as its tool beside the shortened path), clamped to two lines
 * that the state line opens in place, then how many instructions are queued behind it, small and
 * muted. Then "Review request details" where they add to the action (see `rowReviewView`),
 * closed at first. Last, Allow once and Decline where the request can be answered here; a question, a plan
 * or a mode change has "Open chat" instead. Once answered, the daemon rewrites the same item, and
 * it becomes an answered row in the same place.
 */
function PendingBlock({
  itemId,
  notice,
  chat,
}: {
  itemId: string;
  notice: PendingNotice;
  chat: SupervisorReference;
}) {
  const agents = useAgents();
  const home = useHomePath();
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const text = useRef<HTMLDivElement>(null);
  // Whether two lines cut the action short, measured again as the chat or the text changes.
  useLayoutEffect(() => {
    const element = text.current;
    if (!element || open) return;
    const check = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, notice.action]);
  const agent = agents.find((a) => a.id === notice.sessionId);
  const request = agent?.pending.find((p) => p.id === notice.requestId);
  // The notice names a file by its name alone; the open request holds its path.
  const parts = notice.file && request?.kind === "approval" ? approvalParts(request) : null;
  const short = (path: string) => {
    const relative = agent ? shortPath(path, [agent.directory], null) : path;
    return relative === path ? home(path) : relative;
  };
  const needs = notice.command
    ? { text: notice.action, code: true }
    : notice.file
      ? parts?.tool && parts.target && parts.path
        ? { verb: parts.tool, text: parts.target, path: true }
        : { verb: notice.file.tool, text: notice.file.name }
      : { text: notice.action };
  const expandable = clamped || open;
  const word = pendingWord(notice.kind);
  // What the request would write, change or run, beyond what the action line quotes. A Codex file
  // change keeps its diff in the worker chat's timeline, which this chat does not have: none.
  const details = useMemo(() => (request ? approvalDetails(request) : null), [request]);
  const review = useMemo(() => rowReviewView(details, notice.action), [details, notice.action]);
  const description = rowDescription(details, notice.command);
  return (
    <NeedsBlock
      label={`${chat.label} ${word.toLowerCase()}`}
      chat={chat}
      sessionId={notice.sessionId}
      state={word}
      toggle={expandable ? { open, onToggle: () => setOpen((v) => !v) } : null}
    >
      {/* What Claude Code says the command is for, in words above it as the card has it. */}
      {description && <p className="text-xs break-words text-muted-foreground">{description}</p>}
      <div
        ref={text}
        data-pending-action
        className={`py-0.5 leading-5 break-words text-foreground ${open ? "" : "line-clamp-2"}`}
      >
        <ApprovalAction needs={needs} short={short} ink="text-foreground" />
      </div>
      {notice.queued && (
        <p className="text-xs text-muted-foreground">{queuedWords(notice.queued)}</p>
      )}
      {review && (
        // Capped as the card's are, so open details scroll and the answers stay in reach.
        <div className="mt-1 flex min-h-0 flex-col gap-1">
          <ApprovalReview view={review} />
        </div>
      )}
      {notice.answerable ? (
        <WatchedApproval itemId={itemId} />
      ) : (
        <OpenChatAction sessionId={notice.sessionId} label="Open chat" />
      )}
    </NeedsBlock>
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
        <span className="min-w-0 truncate">{answeredSummary(items)}</span>
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
 * ("Running a command", "Editing app.ts"), or what it waits for, with the turn's time. It takes the place of the
 * step's own row, which joins its run's summary once it is done, and opens to the step's output.
 */
export function LiveLine({
  step,
  waiting,
  voice,
  startedAt,
}: {
  step?: AgentItem | undefined;
  /** Set while the turn waits on the user: what the line says instead of the step. */
  waiting?: string | undefined;
  /** What the line says while it has nothing specific to: the chat's own words (`useLiveVoice`). */
  voice?: Voice | undefined;
  startedAt?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const kind = step && stepKind(step);
  const short = useShortPath();
  const nameOf = useNameOf();
  const control = step && kind === "tool" ? controlStep(step, nameOf, true) : undefined;
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
          {waiting ??
            control?.verb ??
            (kind && kind !== "thinking" ? (
              LIVE_VERBS[kind]
            ) : voice ? (
              <>
                {/* Read out once a wait: the rotation shows, the status says its first line. */}
                <span aria-hidden="true">{voice.line}…</span>
                <span className="sr-only">{voice.first}…</span>
              </>
            ) : (
              "Working…"
            ))}
          {!waiting && kind && kind !== "thinking" && (!control || control.target) && (
            <>
              {" "}
              {/* What it acts on in full ink; "a command" stays as quiet as its verb. */}
              <span
                className={kind === "command" ? "" : "text-foreground"}
                title={stepPaths(step, kind)}
              >
                {control ? control.target : stepTarget(step, kind, short)}
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
  const nameOf = useNameOf();
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
          {open ? "" : toolSummary(latest, nameOf)}
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
