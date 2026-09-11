import { useContext, useEffect, useState, useRef } from "react";
import type { AgentItem } from "@concors/protocol";
import { mergeItems } from "@concors/client-core";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** Stable identities and revisions reconcile page reads with simultaneous streamed updates. */
export { mergeItems };
export function useConversation(sessionId: string) {
  const connection = useContext(TerminalConnectionContext);
  const revision = useRef(0);
  const [items, setItems] = useState<AgentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    let disposed = false;
    const unsubscribe = connection.onAgent((event) => {
      if (
        event.type === "agent.state" &&
        event.agent.id === sessionId &&
        (event.agent.historyRevision ?? 0) !== revision.current
      ) {
        revision.current = event.agent.historyRevision ?? 0;
        setItems([]);
        void refresh();
      }
      if (event.type === "agent.item" && event.item.sessionId === sessionId)
        setItems((current) => mergeItems(current, [event.item]));
    });
    const refresh = async () => {
      try {
        const result = await connection.requestAgent(
          { kind: "read", sessionId },
          crypto.randomUUID(),
        );
        if (disposed) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const page = result.outcome.conversation;
        const reset = revision.current !== (page.agent.historyRevision ?? 0);
        revision.current = page.agent.historyRevision ?? 0;
        setItems((current) => mergeItems(reset ? [] : current, page.items));
        setHasMore(page.hasMore);
        setReady(true);
        setError(null);
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Could not load conversation");
      }
    };
    let requested = false;
    const off = connection.subscribeWorkspace(() => {
      if (!requested) {
        requested = true;
        void refresh();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      off();
    };
  }, [connection, sessionId]);
  const earlier = async () => {
    if (!connection || !items[0]) return;
    const result = await connection.requestAgent(
      { kind: "read", sessionId, before: items[0].position },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    const page = result.outcome.conversation;
    setItems((current) => mergeItems(current, page.items));
    setHasMore(page.hasMore);
  };
  return { items, hasMore, ready, error, earlier };
}
