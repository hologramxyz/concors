import { useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { AgentSettings } from "@concors/protocol";
import { useAgents } from "@/agents/context";
import { AgentModelPicker } from "@/agents/model-picker";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { StepFrame, WaitingForMachine } from "./frame";
import { firstChatTarget, isUntouchedChat } from "./model";

const FIRST_PROMPT =
  "Look around this project and tell me how it's organised, then suggest three things worth improving.";
const IDEAS = [
  "Explain how this project is organised",
  "Find and fix a failing test",
  "Review my last commit",
  "Write a README for this project",
];
const DEFAULT_SETTINGS: AgentSettings = { model: null, effort: null, mode: "default" };

/** Fifth step: the first agent's task, which starts a chat in the new project and ends setup. */
export function FirstAgentStep({
  banner,
  onSelectProject,
  onNewChat,
  onStarted,
  onFinish,
  onBack,
}: {
  banner?: React.ReactNode;
  /** Shows the project, so its chat pane mounts and starts its agent. */
  onSelectProject: (projectId: string) => void;
  /** Opens a new chat tab in the project, when its open tab is not a fresh chat. */
  onNewChat: (projectId: string) => Promise<void>;
  onStarted: (projectId: string, tabId: string) => void;
  /** Ends setup without a first agent, when there is no project to start one in. */
  onFinish: () => void;
  onBack: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const ready = connection?.state.status === "ready" ? connection : null;
  const agents = useAgents();
  const target = firstChatTarget(ready?.workspace);
  const agent = target?.sessionId
    ? agents.find((candidate) => candidate.id === target.sessionId)
    : undefined;
  const [text, setText] = useState(FIRST_PROMPT);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The project shows behind setup, so its chat starts; a used chat gets a fresh one beside it.
  const opened = useRef<string | null>(null);
  // Once the task is sent, its chat is no longer fresh; nothing replaces it on the way out.
  const sent = useRef(false);
  const projectId = target?.project.id;
  const selected = ready?.workspace?.selection?.projectId === projectId;
  // Not known yet, or still starting, counts as fresh: it is waited for, not replaced.
  const fresh =
    !target?.sessionId || !agent || isUntouchedChat(agent) || agent.status === "starting";
  useEffect(() => {
    if (!projectId || sent.current) return;
    if (!selected) onSelectProject(projectId);
    else if (target?.tab && !fresh && opened.current !== projectId) {
      opened.current = projectId;
      void onNewChat(projectId).catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not open a chat"),
      );
    }
  }, [projectId, selected, fresh, target?.tab, onSelectProject, onNewChat]);
  const usable = isUntouchedChat(agent);
  const start = async () => {
    if (!ready || !agent || !target?.tab) return;
    sent.current = true;
    setSending(true);
    setError(null);
    try {
      const result = await ready.requestAgent(
        { kind: "send", sessionId: agent.id, text: text.trim() },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      onStarted(target.project.id, target.tab.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the agent");
      sent.current = false;
      setSending(false);
    }
  };
  const configure = (model: string | null) => {
    if (!ready || !agent) return;
    void ready
      .requestAgent(
        {
          kind: "configure",
          sessionId: agent.id,
          settings: {
            ...(agent.settings ?? DEFAULT_SETTINGS),
            model,
            effort: null,
            serviceTier: null,
            features: {},
          },
          expectedRevision: agent.revision,
        },
        crypto.randomUUID(),
      )
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not change the model"),
      );
  };
  if (!target)
    return (
      <StepFrame
        step={4}
        title="Give your first agent a task"
        description="Your first agent works inside a project. Go back to add one, or finish and add it later."
        banner={banner}
        primary={{ label: "Finish", onClick: onFinish }}
        onBack={onBack}
      >
        {!ready && <WaitingForMachine />}
      </StepFrame>
    );
  return (
    <StepFrame
      step={4}
      title="Give your first agent a task"
      description={
        <>
          It works in <span className="font-semibold text-foreground">{target.project.name}</span>.
          Ask for anything you would ask a teammate.
        </>
      }
      banner={banner}
      primary={{
        label: "Start agent",
        busy: sending,
        disabled: !usable || !text.trim(),
        onClick: () => void start(),
      }}
      onBack={onBack}
    >
      <div className="rounded-2xl border px-4 pt-3.5 pb-3 shadow-xs">
        <textarea
          aria-label="First task"
          value={text}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
        />
        <div className="mt-2 flex min-h-8 items-center gap-2">
          {agent && usable ? (
            <AgentModelPicker agent={agent} disabled={sending} onSelect={configure} />
          ) : (
            <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Getting the agent ready…
            </span>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {IDEAS.map((idea) => (
          <Button
            key={idea}
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setText(idea)}
          >
            {idea}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Setup closes and the chat opens as soon as the agent starts.
      </p>
    </StepFrame>
  );
}
