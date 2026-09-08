import { extractToolCallFilePath } from "./paseo/extract-tool-call-file-path";
import { useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  FileCode,
  LoaderCircle,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import Markdown, { type Components } from "react-markdown";
const markdownComponents: Components = {
  img: () => null,
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};
import remarkGfm from "remark-gfm";
import type { AgentItem } from "@concors/protocol";
import { buildToolCallDisplayModel } from "./paseo/tool-call-display";
import type { ToolCallDetail } from "./paseo/agent-types";
import { hasMeaningfulToolCallDetail } from "./paseo/tool-call-detail-state";

export function TimelineItem({ item }: { item: AgentItem }) {
  const [open, setOpen] = useState(false);
  const data = item.presentation;
  if (item.kind === "user" || item.kind === "assistant")
    return (
      <article
        className={
          item.kind === "user" ? "ml-auto max-w-[90%] rounded-2xl bg-muted/65 px-4 py-3" : "py-1"
        }
      >
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">{item.title}</p>
        <div className="chat-markdown text-sm break-words">
          {item.kind === "user" ? (
            <p className="whitespace-pre-wrap">{item.text}</p>
          ) : (
            <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {item.text}
            </Markdown>
          )}
        </div>
      </article>
    );
  if (data?.type === "plan")
    return (
      <article className="rounded-xl border bg-muted/20 p-4" aria-label="Agent plan">
        <p className="mb-3 text-xs font-medium">
          Plan · {data.steps?.filter((s) => s.status === "completed").length ?? 0}/
          {data.steps?.length ?? 0}
        </p>
        <ol className="space-y-2">
          {data.steps?.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {step.status === "completed" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : step.status === "inProgress" && item.status === "running" ? (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={step.status === "completed" ? "text-muted-foreground" : ""}>
                {step.step}
              </span>
            </li>
          ))}
        </ol>
      </article>
    );
  if (item.kind === "plan")
    return (
      <article className="rounded-xl border p-4">
        <p className="mb-2 text-xs font-medium">{item.title}</p>
        <div className="chat-markdown text-sm">
          <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {item.text}
          </Markdown>
        </div>
      </article>
    );
  if (item.kind === "system")
    return (
      <article className="flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="size-3" />
        <span>
          {item.title} · {item.text}
        </span>
      </article>
    );
  let detail: ToolCallDetail = { type: "unknown", input: item.text, output: item.detail };
  if (data?.type === "shell")
    detail = { type: "shell", command: data.command ?? item.text, output: item.detail };
  if (data?.type === "files")
    detail = { type: "edit", filePath: data.files?.[0]?.path ?? "Files", unifiedDiff: item.detail };
  if (data?.type === "sub_agent")
    detail = { type: "sub_agent", description: item.text, log: item.detail };
  if (data?.type === "thinking")
    detail = { type: "plain_text", label: "Thinking", text: item.text };
  const display = buildToolCallDisplayModel({
    name: item.title,
    status: item.status === "interrupted" ? "canceled" : item.status,
    error: item.status === "failed" ? item.detail : null,
    detail,
  });
  const Icon =
    data?.type === "shell"
      ? Terminal
      : data?.type === "files"
        ? FileCode
        : data?.type === "sub_agent"
          ? Bot
          : Wrench;
  const running = item.status === "running";
  const hasDetails = hasMeaningfulToolCallDetail(detail);
  const filePath = extractToolCallFilePath(detail);
  return (
    <article
      className="overflow-hidden rounded-xl border bg-muted/10"
      aria-label={
        data?.type === "sub_agent"
          ? "Sub-agent activity"
          : data?.type === "thinking"
            ? "Thinking summary"
            : "Tool call"
      }
    >
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {running ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
        ) : item.status === "failed" ? (
          <XCircle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 text-xs font-medium">{display.displayName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {display.summary ?? item.text}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {running ? "Running" : item.status === "completed" ? "Done" : item.status}
        </span>
        {hasDetails && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {data?.children?.map((child) => (
        <div key={child.id} className="border-t px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Bot className="size-3" />
            <span className="truncate font-mono">{child.id}</span>
            <span className="ml-auto text-muted-foreground">{child.status}</span>
          </div>
          {child.message && (
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{child.message}</p>
          )}
        </div>
      ))}
      {open && (
        <div className="max-h-96 overflow-auto border-t p-3 text-xs">
          {filePath && <p className="mb-2 truncate font-mono text-muted-foreground">{filePath}</p>}
          {data?.type === "files" && data.files?.length ? (
            data.files.map((file) => (
              <div key={file.path} className="mb-3">
                <p className="mb-2 font-mono font-medium">{file.path}</p>
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
          ) : data?.type === "thinking" ? (
            <div className="chat-markdown">
              <Markdown components={markdownComponents}>
                {item.text || "Preparing a response…"}
              </Markdown>
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
}
