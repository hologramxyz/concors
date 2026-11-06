import { formatDuration } from "./duration";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useStartingProvider } from "./default-provider";
import { ProviderIcon } from "./provider-icon";
import { useAgents } from "./context";
import { AGENT_DOT_COLOR, chatAgentStatus, type AgentStatus } from "./agent-status";

/**
 * Spins as a whole, the faint ring with its arc: the ring is round, so turning it shows nothing,
 * and WebKit (the Mac and iPhone webviews) moves a whole element without laying the page out
 * again. Spinning a group inside the SVG instead made WebKit lay out the entire window on every
 * frame, a whole core with long chats on screen.
 */
export function AgentLoadingIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className={`${className} animate-spin text-primary [animation-duration:1.4s] motion-reduce:animate-none`}
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A chat pane's agent as its tab shows it: the provider logo with the same status badge, so an agent
 * that finished, failed or waits for an answer is marked on its pane too, and both clear together.
 */
/** A chat's mark before its session starts: the provider its prompt box starts with. */
export function StartingChatIcon() {
  const provider = useStartingProvider();
  return provider ? (
    <ProviderIcon provider={provider} />
  ) : (
    <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
  );
}

export function AgentPaneIcon({ sessionId }: { sessionId: string | null }) {
  const agent = useAgents().find((a) => a.id === sessionId);
  if (!agent)
    return (
      <span className="mx-1 flex size-5 shrink-0 items-center justify-center">
        <StartingChatIcon />
      </span>
    );
  const status = chatAgentStatus(agent);
  return (
    <span
      className="mx-1 flex shrink-0"
      title={agent.settings?.model ?? agent.model ?? status.providerName}
    >
      <AgentStatusIcon
        agent={status}
        surface="bg-card ring-card"
        runningTestId="pane-agent-loading"
      />
    </span>
  );
}

/** Provider logo with a status corner badge, as in the Agents sidebar. */
export function AgentStatusIcon({
  agent,
  label = `Agent status: ${agent.status}`,
  surface = "bg-sidebar ring-sidebar",
  runningTestId,
}: {
  agent: Pick<AgentStatus, "provider" | "status" | "running" | "dot">;
  label?: string;
  /** Background of whatever the icon sits on, so the badge cuts cleanly into the logo. */
  surface?: string;
  /** Marks the badge while the agent works, for tests that follow a particular icon. */
  runningTestId?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className="relative flex size-5 shrink-0 items-center justify-center"
    >
      <span aria-hidden="true" data-provider={agent.provider}>
        <ProviderIcon provider={agent.provider} />
      </span>
      {/* No badge while it sits idle, so a mark always means something. */}
      {(agent.running || agent.dot) && (
        <span
          data-agent-status-badge
          data-testid={agent.running ? runningTestId : undefined}
          className={`absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full ring-1 ${surface}`}
        >
          {agent.running ? (
            <AgentLoadingIcon className="size-3" />
          ) : (
            <span className={`size-2 rounded-full ${agent.dot && AGENT_DOT_COLOR[agent.dot]}`} />
          )}
        </span>
      )}
    </span>
  );
}

// A quiet braille indicator accompanies the animated activity label.
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/**
 * All ten frames stacked in a one-character window, slid up a frame at a time by a CSS animation.
 * No timer and no re-render: WebKit (the Mac and iPhone webviews) moves the column without laying
 * out or repainting the chat around it, which changing the character ten times a second did, a
 * cost that grew with the length of the chat on screen.
 */
export function BrailleSpinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-4 shrink-0 overflow-hidden font-mono text-[16px] leading-5 text-muted-foreground [contain:strict]"
    >
      <span className="braille-frames block">
        {frames.map((frame) => (
          <span key={frame} className="block h-5">
            {frame}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Activity({
  children,
  startedAt,
}: {
  children: React.ReactNode;
  startedAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt ? (now - Date.parse(startedAt)) / 1000 : null;
  return (
    <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
      <BrailleSpinner />
      {elapsed !== null && Number.isFinite(elapsed) && (
        <span aria-label="Elapsed time" className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(elapsed)}
        </span>
      )}
      <span className="agent-shimmer">{children}</span>
    </div>
  );
}
