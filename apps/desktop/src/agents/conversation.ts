import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { mergeItems } from "@concors/client-core";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import type { DaemonConnection } from "@concors/daemon-client";
import { ConversationHistory, type HistoryCursor } from "./conversation-history";

export { mergeItems };

/** Conversations recently shown per connection, most recent last. */
const RETAINED_CONVERSATIONS = 24;
const retained = new WeakMap<DaemonConnection, Map<string, ConversationHistory>>();

/**
 * Reopening a chat (another project, or back from Settings) shows what it showed before and then
 * fetches only what arrived since, the same catch-up a reconnect does, instead of reloading it.
 */
function conversationHistory(connection: DaemonConnection | null, sessionId: string) {
  const read = async (cursor: HistoryCursor) => {
    if (!connection) throw new Error("Machine is disconnected");
    const result = await connection.requestAgent(
      { kind: "read", sessionId, ...cursor },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    return result.outcome.conversation;
  };
  if (!connection) return new ConversationHistory(read);
  let histories = retained.get(connection);
  if (!histories) retained.set(connection, (histories = new Map()));
  const kept = histories.get(sessionId);
  const snapshot = kept?.getSnapshot();
  // A window paged away from the tail would reopen mid-conversation; start that one afresh.
  const history =
    kept && !snapshot?.hasNewer && !snapshot?.error ? kept : new ConversationHistory(read);
  histories.delete(sessionId);
  histories.set(sessionId, history);
  for (const oldest of histories.keys()) {
    if (histories.size <= RETAINED_CONVERSATIONS) break;
    histories.delete(oldest);
  }
  return history;
}

export function useConversation(sessionId: string) {
  const connection = useContext(TerminalConnectionContext);
  const history = useMemo(
    () => conversationHistory(connection, sessionId),
    [connection, sessionId],
  );
  const snapshot = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => {
    if (!connection) return;
    let requested = false;
    const unsubscribe = connection.onAgent((event) => {
      if (event.type === "agent.state" && event.agent.id === sessionId)
        history.invalidate(event.agent);
      if (event.type === "agent.list") {
        const agent = event.agents.find((agent) => agent.id === sessionId);
        if (agent) history.invalidate(agent);
      }
      if (event.type === "agent.item" && event.item.sessionId === sessionId)
        history.receive(event.item);
    });
    const offState = connection.subscribe((state) => {
      if (state.status !== "ready") {
        requested = false;
        history.cancel();
      }
    });
    const off = connection.subscribeWorkspace(() => {
      if (!requested && connection.state.status === "ready") {
        requested = true;
        void history.resume();
      }
    });
    return () => {
      unsubscribe();
      offState();
      off();
      history.cancel();
    };
  }, [connection, sessionId, history]);
  return {
    ...snapshot,
    load: history.load,
    reveal: history.reveal,
    setFollowing: history.setFollowing,
  };
}
