import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";
import type { AgentItem } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Activity } from "./activity";
import { LIVE_SUB_AGENT, SubAgentViewContext, type SubAgentTarget } from "./sub-agent-context";
import { TimelineItem } from "./timeline-item";

/** How often a working sub-agent's conversation is read again. */
const REFRESH_MS = 2000;

/**
 * A sub-agent's own conversation, read-only, beside the chat that started it: its prompt, the
 * commands and edits it made and what it said, drawn as the chat draws its own. It is read again
 * every few seconds while the sub-agent works. There is no composer: a sub-agent takes its
 * instructions from the agent that started it, not from the person.
 */
export function SubAgentPanel({
  sessionId,
  target,
  item = target.item,
  turnActive,
  onClose,
}: {
  sessionId: string;
  target: SubAgentTarget;
  /** The starting call as the chat has it now, so the panel follows its status. */
  item?: AgentItem | undefined;
  /** Whether the parent chat's turn is still running; a finished turn has nothing live left. */
  turnActive: boolean;
  onClose: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [items, setItems] = useState<AgentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const child = item.presentation?.children?.find((c) => c.id === target.childId);
  const running = turnActive && LIVE_SUB_AGENT.includes(child?.status ?? item.status);
  const label =
    (item.presentation?.agentType?.trim() || "Sub-agent") +
    (target.index !== undefined ? ` ${target.index + 1}` : "");

  useEffect(() => {
    if (!connection) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await connection.requestAgent(
          { kind: "child-history", sessionId, itemId: target.item.id, childId: target.childId },
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
  }, [connection, sessionId, target.item.id, target.childId, running]);

  // Follows new messages while the reader is at the bottom, as the chat does.
  useLayoutEffect(() => {
    const element = log.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [items]);

  return (
    <aside
      aria-label="Sub-agent conversation"
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
              : "Done"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close sub-agent conversation"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div
        ref={log}
        role="log"
        aria-label="Sub-agent timeline"
        // Focusable so it scrolls with the keyboard and Escape reaches the panel from it.
        tabIndex={0}
        className="chat-scroll selectable min-h-0 flex-1 overflow-y-auto px-3 py-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {/* Its own sub-agents belong to its conversation, which this chat cannot open. */}
        <SubAgentViewContext value={null}>
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
        </SubAgentViewContext>
      </div>
      <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
        Read-only. Sub-agents take their instructions from the agent that started them.
      </p>
    </aside>
  );
}
