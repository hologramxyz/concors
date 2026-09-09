import { useEffect, useRef, useState } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentItem, AgentOperation } from "@concors/protocol";
import { mergeItems, newRequestId } from "@concors/client-core";

export function useConversation(connection: DaemonConnection | null, sessionId: string) {
  const [items, setItems] = useState<AgentItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<DaemonConnection | null>(null);
  const loading = !connection || loadedFrom !== connection;
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const attempt = ++generation.current;
    if (!connection) return;
    let latest: AgentItem[] = [];
    const off = connection.onAgent((event) => {
      if (event.type !== "agent.item" || event.item.sessionId !== sessionId) return;
      latest = mergeItems(latest, [event.item]);
      setItems((current) => mergeItems(current, [event.item]));
    });
    void connection
      .requestAgent({ kind: "read", sessionId }, newRequestId())
      .then((result) => {
        if (generation.current !== attempt) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        // A fresh bounded tail replaces cached history on resume; old pages remain loadable.
        setItems(mergeItems(result.outcome.conversation.items, latest));
        setHasMore(result.outcome.conversation.hasMore);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (attempt === generation.current)
          setError(cause instanceof Error ? cause.message : "Could not load the conversation.");
      })
      .finally(() => {
        if (attempt === generation.current) setLoadedFrom(connection);
      });
    // Invalidate asynchronous protocol replies, including replies after unmount.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      off();
    };
  }, [connection, sessionId]);
  const request = async (operation: AgentOperation) => {
    if (!connection) throw new Error("Reconnect before interacting with this session.");
    const attempt = generation.current;
    const result = await connection.requestAgent(operation, newRequestId());
    if (generation.current !== attempt)
      throw new Error("Connection changed. Check the session before trying again.");
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    const page = result.outcome.conversation;
    setItems((current) => mergeItems(current, page.items));
    if (operation.kind === "read") setHasMore(page.hasMore);
    return page;
  };
  return {
    items,
    hasMore,
    loading,
    error,
    request,
    earlier: () =>
      request({ kind: "read", sessionId, ...(items[0] ? { before: items[0].position } : {}) }),
  };
}
