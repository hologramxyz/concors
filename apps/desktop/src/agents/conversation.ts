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
  const generation = useRef(Symbol());
  const pageRequest = useRef<Promise<AgentItem[]> | null>(null);
  useEffect(() => {
    if (!connection) return;
    generation.current = Symbol();
    let disposed = false;
    const unsubscribe = connection.onAgent((event) => {
      if (
        event.type === "agent.state" &&
        event.agent.id === sessionId &&
        (event.agent.historyRevision ?? 0) !== revision.current
      ) {
        revision.current = event.agent.historyRevision ?? 0;
        generation.current = Symbol();
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
      generation.current = Symbol();
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
  const reveal = (position: number) => {
    if (pageRequest.current) return pageRequest.current;
    const currentGeneration = generation.current;
    const load = async () => {
      let first = items[0]?.position;
      let more = hasMore;
      let fetched: AgentItem[] = [];
      while (connection && first !== undefined && first > position && more) {
        const result = await connection.requestAgent(
          { kind: "read", sessionId, before: first },
          crypto.randomUUID(),
        );
        if (generation.current !== currentGeneration)
          throw new Error("Conversation changed. Select the message again.");
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const page = result.outcome.conversation;
        if ((page.agent.historyRevision ?? 0) !== revision.current)
          throw new Error("Conversation changed. Select the message again.");
        const next = page.items[0]?.position;
        if (next === undefined || next >= first)
          throw new Error("This message is no longer available.");
        fetched = [...page.items, ...fetched];
        first = next;
        more = page.hasMore;
      }
      if (fetched.length) {
        setItems((current) => mergeItems(current, fetched));
        setHasMore(more);
      }
      return fetched;
    };
    pageRequest.current = load().finally(() => {
      pageRequest.current = null;
    });
    return pageRequest.current;
  };
  return { items, hasMore, ready, error, earlier, reveal };
}
