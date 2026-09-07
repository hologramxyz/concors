import { useContext, useEffect, useState } from "react";
import type { AgentItem } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** Stable identities and revisions reconcile page reads with simultaneous streamed updates. */
export function mergeItems(current: AgentItem[], incoming: AgentItem[]): AgentItem[] {
  const map = new Map(current.map((i) => [i.id, i]));
  for (const item of incoming) {
    const prior = map.get(item.id);
    if (!prior || prior.revision <= item.revision) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => a.position - b.position);
}
export function useConversation(sessionId: string) {
  const connection = useContext(TerminalConnectionContext);
  const [items, setItems] = useState<AgentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    let disposed = false;
    const unsubscribe = connection.onAgent((event) => {
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
        setItems((current) => mergeItems(current, page.items));
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
