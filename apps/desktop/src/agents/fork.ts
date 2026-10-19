import { useContext } from "react";
import type { AgentInfo, AgentItem } from "@concors/protocol";
import { AgentStartedContext } from "./context";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** Whether the agent can be forked right now; a busy agent is refused by the daemon. */
export function canFork(agent: AgentInfo | undefined): agent is AgentInfo {
  return (
    !!agent?.controls?.fork &&
    !!agent.threadId &&
    !["starting", "working", "needs_input"].includes(agent.status)
  );
}

/** The last reply of each turn, where "Fork from here" sits. */
export function forkReplies(items: AgentItem[]): Set<string> {
  const last = new Map<string, string>();
  for (const item of items) if (item.kind === "assistant") last.set(item.turnId, item.id);
  return new Set(last.values());
}

/** Copies a chat into a new tab, up to the end of `turnId` or whole, and opens it. */
export function useForkChat() {
  const connection = useContext(TerminalConnectionContext);
  const onStarted = useContext(AgentStartedContext);
  return async (agent: AgentInfo, turnId?: string) => {
    if (!connection) throw new Error("Machine is disconnected");
    const result = await connection.requestAgent(
      {
        kind: "fork-session",
        sessionId: agent.id,
        ...(turnId ? { turnId } : {}),
        expectedRevision: agent.revision,
      },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    onStarted?.(result.outcome.conversation.agent.id);
  };
}
