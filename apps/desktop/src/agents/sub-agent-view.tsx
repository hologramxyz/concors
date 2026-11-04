import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import { SUB_AGENT_STEPS, type AgentItem } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Activity } from "./activity";
import { formatDuration } from "./duration";
import { PlanProgress } from "./plan-progress";
import { stepCount } from "./running-sub-agents";
import { Report, Steps } from "./sub-agent-card";
import { LIVE_SUB_AGENT, SubAgentViewContext, type SubAgentTarget } from "./sub-agent-context";
import { TimelineItem } from "./timeline-item";
import { useElapsed } from "./use-elapsed";

/** How often a working sub-agent's conversation is read again. */
const REFRESH_MS = 2000;

/**
 * A sub-agent's details, read-only, beside the chat that started it. Progress answers "how far has
 * it got": its plan, the steps it took and its latest word. The conversation is everything it said
 * and did, drawn as the chat draws its own, and read again every few seconds while it works. There
 * is no composer: a sub-agent takes its instructions from the agent that started it, not the person.
 */
export function SubAgentPanel({
  sessionId,
  target,
  item = target.item,
  turnActive,
  hasConversation,
  onClose,
}: {
  sessionId: string;
  target: SubAgentTarget;
  /** The starting call as the chat has it now, so the panel follows its status. */
  item?: AgentItem | undefined;
  /**
   * Whether the parent chat's turn is still running. Once it ends, only a sub-agent sent to the
   * background can still be working.
   */
  turnActive: boolean;
  /** Whether this provider keeps a sub-agent's conversation to read. */
  hasConversation: boolean;
  onClose: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [view, setView] = useState<"progress" | "conversation">("progress");
  const [items, setItems] = useState<AgentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const { childId } = target;
  const readable = hasConversation && !!childId;
  const children = item.presentation?.children ?? [];
  const child = children.find((c) => c.id === childId);
  const running =
    (turnActive || (!!item.presentation?.background && item.status === "running")) &&
    LIVE_SUB_AGENT.includes(child?.status ?? item.status);
  const label =
    (item.presentation?.agentType?.trim() || "Sub-agent") +
    (target.index !== undefined ? ` ${target.index + 1}` : "");
  const allSteps = item.presentation?.activity ?? [];
  const steps = children.length > 1 ? allSteps.filter((s) => s.childId === childId) : allSteps;
  const elapsed = useElapsed(item.createdAt, running);
  const plan = items?.findLast((entry) => entry.kind === "plan");
  const showing = readable ? view : "progress";

  useEffect(() => {
    if (!connection || !readable || !childId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await connection.requestAgent(
          { kind: "child-history", sessionId, itemId: target.item.id, childId },
          crypto.randomUUID(),
        );
        if (stopped) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setItems(result.outcome.childItems ?? []);
        setError(null);
      } catch (cause) {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : "Could not read this conversation");
      }
      // Once it has finished, the read above was the last one needed.
      if (!stopped && running) timer = setTimeout(() => void read(), REFRESH_MS);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [connection, readable, sessionId, target.item.id, childId, running]);

  // Opened by a click on something else: Escape should close it straight away.
  useEffect(() => {
    log.current?.focus({ preventScroll: true });
  }, []);

  // Follows what is new while the reader is at the bottom, as the chat does.
  useLayoutEffect(() => {
    const element = log.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [items, steps.length, showing]);

  return (
    <aside
      aria-label="Sub-agent details"
      className="sub-agent-panel flex min-h-0 min-w-0 flex-col border-l bg-background"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2.5 border-b px-3 py-2">
        <span
          aria-hidden="true"
          className={`flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm ${running ? "animate-pulse" : ""}`}
        >
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{label}</h2>
          <p className="truncate text-xs text-muted-foreground" title={item.text}>
            {item.text}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground" role="status">
          {running
            ? "Working"
            : child?.status === "failed" || item.status === "failed"
              ? "Failed"
              : item.status === "interrupted"
                ? "Interrupted"
                : "Done"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close sub-agent details"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      {readable && (
        <div
          role="tablist"
          aria-label="Sub-agent view"
          className="mx-3 mt-2 inline-flex shrink-0 self-start rounded-[calc(var(--radius-md)+(0.125rem+1px)*var(--concentric))] border bg-muted/40 p-0.5"
        >
          {(["progress", "conversation"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={showing === option}
              onClick={() => {
                following.current = true;
                setView(option);
              }}
              className={`flex h-6 items-center rounded-md px-2.5 text-xs capitalize ${
                showing === option
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {/* Held above the steps, which follow the newest and would scroll it out of view. */}
      {showing === "progress" && plan && (
        <div className="max-h-[50%] shrink-0 overflow-y-auto px-3">
          <PlanProgress item={plan} />
        </div>
      )}
      <div
        ref={log}
        role="log"
        aria-label={showing === "progress" ? "Sub-agent progress" : "Sub-agent timeline"}
        // Focusable so it scrolls with the keyboard and Escape reaches the panel from it.
        tabIndex={0}
        className="chat-scroll selectable min-h-0 flex-1 overflow-y-auto px-3 py-4 outline-none"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {/* Its own sub-agents belong to its conversation, which this chat cannot open. */}
        <SubAgentViewContext value={null}>
          {showing === "progress" ? (
            <div className="mx-auto max-w-3xl space-y-3">
              <p className="text-xs text-muted-foreground tabular-nums">
                {[stepCount(steps), running && elapsed > 0 ? formatDuration(elapsed) : null]
                  .filter(Boolean)
                  .join(" · ") || (running ? "Starting…" : "No steps reported.")}
              </p>
              <Steps steps={steps} />
              {steps.length >= SUB_AGENT_STEPS && (
                <p className="text-xs text-muted-foreground">
                  Only its latest {steps.length} steps are listed.
                </p>
              )}
              <Report item={item} childId={undefined} message={child?.message} done={!running} />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {items === null && !error && (
                <p role="status" className="text-sm text-muted-foreground">
                  Reading conversation…
                </p>
              )}
              {items?.map((entry) => (
                <TimelineItem
                  key={`${entry.turnId}:${entry.id}`}
                  item={entry}
                  live={running && entry.status === "running"}
                />
              ))}
              {items?.length === 0 && !running && (
                <p className="text-sm text-muted-foreground">No messages were recorded.</p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {running && <Activity startedAt={item.createdAt}>Working…</Activity>}
            </div>
          )}
        </SubAgentViewContext>
      </div>
      <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
        Read-only. Sub-agents take their instructions from the agent that started them.
      </p>
    </aside>
  );
}
