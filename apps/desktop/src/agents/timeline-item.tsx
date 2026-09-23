import { Button } from "@/components/ui/button";
import { AttachmentPreview } from "./attachment-preview";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useAgents } from "./context";
import { memo, useContext } from "react";
import { FileLinkContext } from "@/files/context";
import { formatDuration } from "./duration";
import { extractToolCallFilePath } from "./paseo/extract-tool-call-file-path";
import { useState } from "react";
import { Bot, ChevronRight, FileCode, Terminal, Wrench, XCircle } from "lucide-react";
import { AgentMarkdown, CopyButton } from "./markdown";
import { PlanProgress } from "./plan-progress";
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
        <div className="chat-markdown break-words">
          {item.kind === "user" ? (
            <p className="whitespace-pre-wrap">{item.text}</p>
          ) : (
            <AgentMarkdown>{item.text}</AgentMarkdown>
          )}
        </div>
        {item.attachments?.map((attachment, index) => (
          <AttachmentPreview key={index} item={item} attachment={attachment} index={index} />
        ))}
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
  if (data?.type === "sub_agent")
    detail = { type: "sub_agent", description: item.text, log: item.detail };
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
                : data?.type === "sub_agent"
                  ? Bot
                  : Wrench;
  const hasDetails = hasMeaningfulToolCallDetail(detail);
  const filePath = extractToolCallFilePath(detail);
  return (
    <article
      data-tool-status={item.status}
      aria-busy={running}
      className="overflow-hidden rounded-xl border border-transparent bg-muted/20"
      aria-label={data?.type === "sub_agent" ? "Sub-agent activity" : "Tool call"}
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
      {data?.children?.map((child) => (
        <div key={child.id} className="border-t px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            {["running", "pending", "inProgress"].includes(child.status) ? (
              <BrailleSpinner />
            ) : (
              <Bot className="size-4" />
            )}
            <span
              title={child.id}
              className={`truncate ${["running", "pending", "inProgress"].includes(child.status) ? "agent-shimmer" : ""}`}
            >
              Agent {child.id.slice(0, 8)}
            </span>
            <span className="ml-auto text-muted-foreground">{child.status}</span>
          </div>
          <ChildConversation parent={item} childId={child.id} />
          {child.message && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Agent update
              </summary>
              <div className="mt-2">
                <AgentMarkdown>{child.message}</AgentMarkdown>
                <CopyButton label="Copy agent update" text={child.message} />
              </div>
            </details>
          )}
        </div>
      ))}
      {open && (
        <div className="chat-scroll max-h-96 overflow-auto border-t p-4 text-ui leading-6">
          <div className="mb-2 flex justify-end">
            <CopyButton text={item.detail || item.text} label="Copy tool output" />
          </div>
          {filePath && (
            <button
              type="button"
              className="mb-2 block max-w-full truncate font-mono text-muted-foreground hover:underline"
              onClick={() => openFile?.(filePath)}
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
                    onClick={() => openFile?.(file.path)}
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

function ChildConversation({ parent, childId }: { parent: AgentItem; childId: string }) {
  const connection = useContext(TerminalConnectionContext),
    agent = useAgents().find((a) => a.id === parent.sessionId);
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<AgentItem[]>([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  if (!agent?.controls?.childHistory) return null;
  const load = async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        { kind: "child-history", sessionId: parent.sessionId, itemId: parent.id, childId },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setItems(result.outcome.childItems ?? []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read child session");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-2 text-xs underline"
          onClick={() => {
            void load();
          }}
        >
          Open agent conversation
        </button>
      </DialogTrigger>
      <DialogContent size="wide" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Agent conversation</DialogTitle>
          <DialogDescription>
            Recent messages from this child agent. Reading them does not send a prompt.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loading ? (
            <p className="text-sm">Reading conversation…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : items.length ? (
            items.map((item) => (
              <article key={item.id} className="space-y-1 text-sm">
                <p className="text-xs text-muted-foreground">{item.title}</p>
                <AgentMarkdown>{item.text || item.detail}</AgentMarkdown>
              </article>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No messages reported yet.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
            Reload conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
