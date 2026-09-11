import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { mergeItems } from "@concors/client-core";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ConversationHistory } from "./conversation-history";

export { mergeItems };
export function useConversation(sessionId: string) {
  const connection = useContext(TerminalConnectionContext);
  const history = useMemo(
    () =>
      new ConversationHistory(async (cursor) => {
        if (!connection) throw new Error("Machine is disconnected");
        const result = await connection.requestAgent(
          { kind: "read", sessionId, ...cursor },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        return result.outcome.conversation;
      }),
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
        void history.load("latest");
      }
    });
    return () => {
      unsubscribe();
      offState();
      off();
      history.cancel();
    };
  }, [connection, sessionId, history]);
  return { ...snapshot, load: history.load, setFollowing: history.setFollowing };
}
