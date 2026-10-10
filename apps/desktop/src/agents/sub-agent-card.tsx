import { useContext, useEffect, useState } from "react";
import { Bot, Check, ChevronRight, PanelRightOpen, X } from "lucide-react";
import type { AgentActivityStep, AgentItem } from "@concors/protocol";
import { BrailleSpinner } from "./activity";
import { formatDuration } from "./duration";
import { AgentMarkdown, CopyButton } from "./markdown";
import { LIVE_SUB_AGENT, SubAgentViewContext } from "./sub-agent-context";

const LIVE = LIVE_SUB_AGENT;

/** Seconds since `since`, ticking while `running`. */
function useElapsed(since: string, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
}

/**
 * A sub-agent a turn started: one quiet row, as a tool call is, naming its kind and task. While
 * it works, the step it is on shows underneath; opening the row lists the steps it took and what
 * it reported back.
 */
export function SubAgentCard({ item, running }: { item: AgentItem; running: boolean }) {
  const [open, setOpen] = useState(false);
  const data = item.presentation;
  const steps = data?.activity ?? [];
  const children = data?.children ?? [];
  const failed = item.status === "failed";
  const elapsed = useElapsed(item.createdAt, running);
  const current = running ? steps.findLast((step) => step.status === "running") : undefined;
  const label = data?.agentType?.trim() || "Sub-agent";
  const summary = [
    steps.length ? `${steps.length} ${steps.length === 1 ? "step" : "steps"}` : null,
    running && elapsed > 0 ? formatDuration(elapsed) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      data-tool-status={item.status}
      data-sub-agent={item.id}
      aria-busy={running}
      aria-label="Sub-agent activity"
      className="overflow-hidden rounded-xl border border-transparent bg-muted/20"
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
        >
          {/* A robot badge sets sub-agents apart from the tool calls around them. */}
          <span
            data-sub-agent-badge
            aria-hidden="true"
            className={`flex size-5 shrink-0 items-center justify-center rounded-md shadow-sm ${
              failed ? "bg-destructive text-white" : "bg-primary text-primary-foreground"
            } ${running ? "animate-pulse" : ""}`}
          >
            <Bot className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <span className={`shrink-0 font-medium ${running ? "agent-shimmer" : ""}`}>
                {label}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-muted-foreground ${running ? "agent-shimmer" : ""}`}
              >
                {item.text}
              </span>
              {summary && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {summary}
                </span>
              )}
              {(failed || item.status === "interrupted") && (
                <span className="shrink-0 text-xs text-muted-foreground">{item.status}</span>
              )}
              <ChevronRight
                className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
              />
            </span>
            {current && (
              <span
                data-sub-agent-current
                className="truncate text-xs text-muted-foreground"
                title={`${current.title} ${current.text}`}
              >
                {current.title}
                {current.text ? ` · ${current.text}` : ""}
              </span>
            )}
          </span>
        </button>
        {children.length === 1 && children[0] && (
          <OpenConversation
            item={item}
            childId={children[0].id}
            className="m-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelRightOpen className="size-4" />
          </OpenConversation>
        )}
      </div>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {children.length > 1 ? (
            children.map((child, index) => (
              <section key={child.id} aria-label={`Sub-agent ${index + 1}`} className="space-y-1.5">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {LIVE.includes(child.status) ? <BrailleSpinner /> : <Bot className="size-3.5" />}
                  Agent {index + 1}
                  <span className="ml-auto">{child.status}</span>
                </p>
                <Steps steps={steps.filter((step) => step.childId === child.id)} />
                <Report
                  item={item}
                  childId={child.id}
                  index={index}
                  message={child.message}
                  done={!LIVE.includes(child.status)}
                />
              </section>
            ))
          ) : (
            <>
              <Steps steps={steps} />
              {!steps.length && (
                <p className="text-xs text-muted-foreground">
                  {running ? "Starting…" : "No steps reported."}
                </p>
              )}
              <Report
                item={item}
                childId={children[0]?.id}
                message={children[0]?.message}
                done={!running}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Steps({ steps }: { steps: readonly AgentActivityStep[] }) {
  if (!steps.length) return null;
  return (
    <ol aria-label="Steps" className="space-y-1 border-l pl-3">
      {steps.map((step) => (
        <li
          key={step.id}
          data-step-status={step.status}
          className="flex min-w-0 items-center gap-2 text-xs"
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {step.status === "running" ? (
              <BrailleSpinner />
            ) : step.status === "failed" ? (
              <X className="size-3 text-destructive" aria-label="Failed" />
            ) : (
              <Check className="size-3 text-muted-foreground" aria-label="Done" />
            )}
          </span>
          <span className="w-28 shrink-0 truncate font-medium">{step.title}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What the sub-agent reported back, and its whole conversation where the CLI keeps one. */
function Report({
  item,
  childId,
  index,
  message,
  done,
}: {
  item: AgentItem;
  childId: string | undefined;
  index?: number;
  message: string | null | undefined;
  done: boolean;
}) {
  if (!message && !childId) return null;
  return (
    <div className="space-y-1">
      {message && (
        <>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {done ? "Result" : "Latest update"}
            <CopyButton label="Copy sub-agent report" text={message} />
          </p>
          <div className="text-sm">
            <AgentMarkdown>{message}</AgentMarkdown>
          </div>
        </>
      )}
      {/* A single sub-agent opens from its row's own button. */}
      {childId && index !== undefined && (
        <OpenConversation
          item={item}
          childId={childId}
          index={index}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Open agent conversation
        </OpenConversation>
      )}
    </div>
  );
}

/** Opens the sub-agent's conversation beside the chat, where its provider keeps one. */
function OpenConversation({
  item,
  childId,
  index,
  className,
  children,
}: {
  item: AgentItem;
  childId: string;
  index?: number | undefined;
  className: string;
  children: React.ReactNode;
}) {
  const open = useContext(SubAgentViewContext);
  if (!open) return null;
  return (
    <button
      type="button"
      aria-label={
        index === undefined ? "Open agent conversation" : `Open agent ${index + 1} conversation`
      }
      title="Open its conversation beside this chat"
      className={className}
      onClick={() => open({ item, childId, index })}
    >
      {children}
    </button>
  );
}
