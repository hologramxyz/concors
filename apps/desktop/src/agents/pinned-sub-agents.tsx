import { Bot, PanelRightOpen } from "lucide-react";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { formatDuration } from "./duration";
import type { RunningSubAgent } from "./running-sub-agents";
import { stepCount } from "./running-sub-agents";
import type { SubAgentTarget } from "./sub-agent-context";
import { useElapsed } from "./use-elapsed";

/**
 * The sub-agents working right now, held above the composer so they stay in view however far the
 * timeline has moved on from the rows that started them. Each opens its details beside the chat.
 * A sub-agent leaves the list when it finishes; its row in the timeline keeps the record.
 */
export function PinnedSubAgents({
  agents,
  open,
  onOpen,
  onClose,
}: {
  agents: readonly RunningSubAgent[];
  /** What the side panel shows now, so pressing that sub-agent again closes it. */
  open: SubAgentTarget | null;
  onOpen: (target: SubAgentTarget) => void;
  onClose: () => void;
}) {
  if (!agents.length) return null;
  return (
    <section
      aria-label="Running sub-agents"
      className="chat-scroll max-h-40 divide-y overflow-y-auto rounded-xl border bg-muted/20"
    >
      {agents.map((agent) => {
        const selected = !!open && (open.childId ?? open.item.id) === agent.key;
        return (
          <PinnedRow
            key={agent.key}
            agent={agent}
            selected={selected}
            onPress={() =>
              selected
                ? onClose()
                : onOpen({ item: agent.item, childId: agent.childId, index: agent.index })
            }
          />
        );
      })}
    </section>
  );
}

function PinnedRow({
  agent,
  selected,
  onPress,
}: {
  agent: RunningSubAgent;
  selected: boolean;
  onPress: () => void;
}) {
  const elapsed = useElapsed(agent.item.createdAt, true);
  const current = agent.steps.findLast((step) => step.status === "running");
  const label =
    (agent.item.presentation?.agentType?.trim() || "Sub-agent") +
    (agent.index !== undefined ? ` ${agent.index + 1}` : "");
  const summary = [stepCount(agent.steps), elapsed > 0 ? formatDuration(elapsed) : null].filter(
    Boolean,
  );
  return (
    <SidebarTooltip place="above" content={selected ? "Close details" : "Open details"}>
      <button
        type="button"
        aria-pressed={selected}
        data-pinned-sub-agent={agent.key}
        onClick={onPress}
        className={`flex w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/50 ${selected ? "bg-muted/60" : ""}`}
      >
        <span
          aria-hidden="true"
          className="mt-px flex size-4 shrink-0 animate-pulse items-center justify-center rounded bg-primary text-primary-foreground motion-reduce:animate-none"
        >
          <Bot className="size-3" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 font-medium">{label}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{agent.task}</span>
            {summary.length > 0 && (
              <span className="flex shrink-0 gap-2 text-muted-foreground tabular-nums">
                {summary.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </span>
            )}
          </span>
          {current && (
            <span className="truncate text-xs text-muted-foreground">
              {current.title}
              {current.text ? ` ${current.text}` : ""}
            </span>
          )}
        </span>
        <PanelRightOpen
          aria-hidden="true"
          className="mt-px size-3.5 shrink-0 text-muted-foreground"
        />
      </button>
    </SidebarTooltip>
  );
}
