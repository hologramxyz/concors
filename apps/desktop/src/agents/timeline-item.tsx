import { MessageAttachments } from "./attachment-preview";
import { memo, useContext } from "react";
import { FileLinkContext } from "@/files/context";
import { formatDuration } from "./duration";
import { extractToolCallFilePath } from "./paseo/extract-tool-call-file-path";
import { useState } from "react";
import { ChevronRight, FileCode, Terminal, Wrench, XCircle } from "lucide-react";
import { AgentMarkdown, CopyButton } from "./markdown";
import { PlanProgress } from "./plan-progress";
import { SubAgentCard } from "./sub-agent-card";
import { BrailleSpinner } from "./activity";
import { Brain, Eye, Globe, Search, Pencil } from "lucide-react";
import { resolveToolCallIconName } from "./paseo/tool-call-icon-name";
import type { AgentItem } from "@concors/protocol";
import { buildToolCallDisplayModel } from "./paseo/tool-call-display";
import type { ToolCallDetail } from "./paseo/agent-types";
import { hasMeaningfulToolCallDetail } from "./paseo/tool-call-detail-state";
import { thinkingExpandable, thinkingPreview, thinkingText } from "./thinking";

/** Memoized: merges keep unchanged items' identity, so a streamed delta re-renders one row
 * instead of re-parsing every message's Markdown while the user scrolls. */
export const TimelineItem = memo(function TimelineItem({
  item,
  workedFor,
  live,
}: {
  item: AgentItem;
  workedFor?: string | undefined;
  /** Whether the item's turn is still in progress; a finished turn has nothing left running. */
  live: boolean;
}) {
  const openFile = useContext(FileLinkContext);
  const [open, setOpen] = useState(false);
  const data = item.presentation;
  const running = live && item.status === "running";
  if (item.kind === "user" || item.kind === "assistant")
    return (
      <article
        className={
          item.kind === "user" ? "ml-auto max-w-[90%] rounded-2xl bg-muted/65 px-4 py-3" : "py-1"
        }
      >
        {item.kind === "user" && <MessageAttachments item={item} className="mb-2" />}
        <div className="chat-markdown break-words">
          {item.kind === "user" ? (
            <p className="whitespace-pre-wrap">{item.text}</p>
          ) : (
            <AgentMarkdown item={item}>{item.text}</AgentMarkdown>
          )}
        </div>
        {item.kind === "assistant" && !running && (
          <div className="mt-2 flex items-center gap-2">
            <CopyButton text={item.text} />
            {workedFor && (
              <span className="text-xs text-muted-foreground">Worked for {workedFor}</span>
            )}
          </div>
        )}
      </article>
    );
  if (data?.type === "plan" || item.kind === "plan") return <PlanProgress item={item} />;
  if (data?.type === "thinking") return <Thinking item={item} running={running} />;
  if (data?.type === "sub_agent") return <SubAgentCard item={item} running={running} />;
  if (item.kind === "system")
    return (
      <article className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {item.id === `turn:${item.turnId}` &&
          item.status === "completed" &&
          /^\d+s$/.test(item.text)
            ? `Worked for ${formatDuration(Number(item.text.slice(0, -1)))}`
            : `${item.title}${item.text ? ` · ${item.text}` : ""}`}
        </span>
      </article>
    );
  let detail: ToolCallDetail = { type: "unknown", input: item.text, output: item.detail };
  if (data?.type === "shell")
    detail = { type: "shell", command: data.command ?? item.text, output: item.detail };
  if (data?.type === "files")
    detail =
      data.fileOperation === "read"
        ? { type: "read", filePath: data.files?.[0]?.path ?? item.text, content: item.detail }
        : { type: "edit", filePath: data.files?.[0]?.path ?? "Files", unifiedDiff: item.detail };
  if (data?.type === "search") detail = { type: "search", query: item.text };
  const display = buildToolCallDisplayModel({
    name: item.title,
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
  const filePath = extractToolCallFilePath(detail);
  return (
    <article
      data-tool-status={item.status}
      aria-busy={running}
      className="overflow-hidden rounded-xl border border-transparent bg-muted/20"
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
          {display.summary ?? item.text}
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
        <div className="chat-scroll max-h-96 overflow-auto border-t p-4 text-ui leading-6">
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
                <pre className="break-words whitespace-pre-wrap">
                  {data.input || "No arguments"}
                </pre>
              </section>
              <section>
                <h4 className="mb-1 font-medium">
                  {item.status === "failed" ? "Error" : "Result"}
                </h4>
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
        </div>
      )}
    </article>
  );
});

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
