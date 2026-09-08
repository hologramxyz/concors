import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { CodexIcon } from "./paseo/codex-icon";
import { useAgents, AGENT_STATUS } from "./context";

export function AgentLoadingIcon({ className = "size-4" }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`${className} animate-spin text-amber-500 motion-reduce:animate-none`}
    />
  );
}

export function AgentPaneIcon({ sessionId }: { sessionId: string | null }) {
  const agent = useAgents().find((a) => a.id === sessionId);
  const running = agent?.status === "working" || agent?.status === "starting";
  return (
    <span
      className="relative mx-1 flex size-5 shrink-0 items-center justify-center"
      title={agent?.settings?.model ?? agent?.model ?? "Codex"}
      aria-label={agent ? `Agent status: ${AGENT_STATUS[agent.status]}` : "Codex"}
    >
      <CodexIcon size={18} />
      {running && (
        <span
          data-testid="pane-agent-loading"
          className="absolute -top-1 -right-1 rounded-full bg-card p-px"
        >
          <AgentLoadingIcon className="size-3" />
        </span>
      )}
    </span>
  );
}

// A quiet braille indicator accompanies Paseo's animated text treatment.
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

export function Activity({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-2 py-3 text-[14px] text-muted-foreground">
      <BrailleSpinner />
      <span className="agent-shimmer">{children}</span>
    </div>
  );
}
