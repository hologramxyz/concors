import { useContext, useState } from "react";
import type { AgentInfo, AgentPending } from "@concors/protocol";
import { cn } from "cn";
import { useAgents } from "@/agents/context";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { quickChoices, type QuickChoice } from "./quick-choices";

/** Answers an approval where it is reported, as its chat's own buttons would. */
export function QuickApproval({
  agent,
  pending,
  className,
}: {
  agent: AgentInfo;
  pending: AgentPending;
  className?: string;
}) {
  const connection = useContext(TerminalConnectionContext);
  // Answered stays answered: the buttons stay off until the request's row or message goes.
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = quickChoices(pending);
  if (!choices || !connection) return null;
  const ready = connection.state.status === "ready";
  const respond = async ({ decision, actionId }: QuickChoice) => {
    setBusy(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        {
          kind: "respond",
          sessionId: agent.id,
          pendingId: pending.id,
          decision,
          ...(actionId ? { actionId } : {}),
        },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setAnswered(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not answer");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Button
        size="xs"
        disabled={busy || answered || !ready}
        onClick={() => void respond(choices.allow)}
      >
        {choices.allow.label}
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={busy || answered || !ready}
        onClick={() => void respond(choices.decline)}
      >
        {choices.decline.label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/**
 * Supervisor's message that a session needs approval, answerable where it is read while the
 * request is still open. Its ID names the session and the request it reports.
 */
export function WatchedApproval({ itemId }: { itemId: string }) {
  const agents = useAgents();
  const match = /^supervisor-watch:[^:]+:([^:]+):input:.+:([^:]+)$/.exec(itemId);
  const agent = match ? agents.find((a) => a.id === match[1]) : undefined;
  const pending = agent?.pending.find((p) => p.id === match?.[2]);
  return agent && pending ? (
    <QuickApproval agent={agent} pending={pending} className="mt-2" />
  ) : null;
}

/**
 * What an approval would do, as Overview's line shows it after "Approve:": a command in plain
 * monospace that wraps at spaces (only a token longer than the line breaks inside, by the line's
 * break-words), a file request as the tool in muted ink beside the shortened path, anything else
 * as written. `ink` is what the path is drawn in, a step stronger than the line around it.
 */
export function ApprovalAction({
  needs,
  short,
  ink = "text-sidebar-foreground/90",
}: {
  needs: { text: string; code?: boolean; verb?: string; path?: boolean };
  short: (path: string) => string;
  ink?: string;
}) {
  if (needs.code) return <code className="font-mono text-[12px]">{needs.text}</code>;
  if (needs.verb)
    return (
      <>
        <span>{needs.verb}</span>{" "}
        <span className={ink} title={needs.text}>
          {needs.path ? short(needs.text) : needs.text}
        </span>
      </>
    );
  return <>{needs.text}</>;
}
