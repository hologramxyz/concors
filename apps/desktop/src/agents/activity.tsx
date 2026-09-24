import { formatDuration } from "./duration";
import { useEffect, useState } from "react";
import { ProviderIcon } from "./provider-icon";
import { agentProviderName } from "@concors/protocol";
import { useAgents, AGENT_STATUS, agentDisplayStatus } from "./context";
import type { AgentStatus } from "./agent-status";

export function AgentLoadingIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`${className} text-primary`}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <g className="origin-center animate-spin [animation-duration:1.4s] motion-reduce:animate-none">
        <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="10" cy="10" r="1.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

export function AgentPaneIcon({ sessionId }: { sessionId: string | null }) {
  const agent = useAgents().find((a) => a.id === sessionId);
  const running = agent?.status === "working" || agent?.status === "starting";
  return (
    <span
      className="relative mx-1 flex size-5 shrink-0 items-center justify-center"
      title={
        agent?.settings?.model ?? agent?.model ?? agentProviderName(agent?.provider ?? "codex")
      }
      aria-label={agent ? `Agent status: ${AGENT_STATUS[agentDisplayStatus(agent)]}` : "Codex"}
    >
      <ProviderIcon provider={agent?.engine ?? agent?.provider ?? "codex"} />
      {running && (
        <span
          data-testid="pane-agent-loading"
          className="absolute -right-1 -bottom-1 rounded-full bg-card p-px"
        >
          <AgentLoadingIcon className="size-3" />
        </span>
      )}
    </span>
  );
}

/** Provider logo with a status corner badge, as in the Agents sidebar. */
export function AgentStatusIcon({
  agent,
  label = `Agent status: ${agent.status}`,
  surface = "bg-sidebar ring-sidebar",
}: {
  agent: Pick<AgentStatus, "provider" | "status" | "running" | "color" | "unread">;
  label?: string;
  /** Background of whatever the icon sits on, so the badge cuts cleanly into the logo. */
  surface?: string;
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
      {agent.unread && (
        <span
          aria-label="Unread agent update"
          className={`absolute -top-1 -left-1 size-1.5 rounded-full bg-primary ring-2 ${surface}`}
        />
      )}
      <span
        data-agent-status-badge
        className={`absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full ring-1 ${surface}`}
      >
        {agent.running ? (
          <AgentLoadingIcon className="size-3" />
        ) : (
          <span className={`size-2 rounded-full ${agent.color}`} />
        )}
      </span>
    </span>
  );
}

// A quiet braille indicator accompanies the animated activity label.
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!motion.matches) timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 90);
    };
    update();
    motion.addEventListener("change", update);
    return () => {
      clearInterval(timer);
      motion.removeEventListener("change", update);
    };
  }, []);
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4 shrink-0 font-mono text-[16px] text-muted-foreground"
    >
      {frames[frame]}
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
