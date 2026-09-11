import { useContext, useEffect, useMemo, useState } from "react";
import type { AgentItem, AgentMessageIndex } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export type MessageEntry = AgentMessageIndex["messages"][number];
export function messageEntry(item: AgentItem): MessageEntry {
  return {
    id: item.id,
    position: item.position,
    preview: (
      item.text.replace(/\s+/g, " ").trim() ||
      item.attachments?.[0]?.name ||
      "Attachment"
    ).slice(0, 240),
  };
}

export function mergeMessageIndex(index: MessageEntry[], items: AgentItem[]) {
  const entries = new Map(index.map((entry) => [entry.id, entry]));
  for (const item of items) if (item.kind === "user") entries.set(item.id, messageEntry(item));
  return [...entries.values()].sort((a, b) => a.position - b.position);
}

export function useMessageIndex(
  sessionId: string,
  historyRevision: number,
  ready: boolean,
  items: AgentItem[],
) {
  const connection = useContext(TerminalConnectionContext);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-message-navigation");
  const [index, setIndex] = useState<{ revision: number; entries: MessageEntry[] }>({
    revision: historyRevision,
    entries: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!connection) return;
    return connection.onAgent((event) => {
      if (
        event.type !== "agent.item" ||
        event.item.sessionId !== sessionId ||
        event.item.kind !== "user"
      )
        return;
      // Live prompts remain navigable even while the timeline holds an older window.
      setIndex((current) => ({
        revision: historyRevision,
        entries: mergeMessageIndex(current.revision === historyRevision ? current.entries : [], [
          event.item,
        ]),
      }));
    });
  }, [connection, sessionId, historyRevision]);
  useEffect(() => {
    if (!connection || !supported || !ready) return;
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      let before: number | undefined;
      let entries: MessageEntry[] = [];
      try {
        do {
          const result = await connection.requestAgent(
            { kind: "list-messages", sessionId, ...(before === undefined ? {} : { before }) },
            crypto.randomUUID(),
          );
          if (disposed) return;
          if (result.outcome.status === "error") throw new Error(result.outcome.message);
          // A rewind invalidates both the index and any in-flight older pages.
          if ((result.outcome.conversation.agent.historyRevision ?? 0) !== historyRevision) return;
          const page = result.outcome.messageIndex;
          if (!page) throw new Error("Message navigation is unavailable on this machine.");
          entries = [...page.messages, ...entries];
          setIndex((current) => ({
            revision: historyRevision,
            entries: [
              ...new Map(
                [...entries, ...(current.revision === historyRevision ? current.entries : [])].map(
                  (entry) => [entry.id, entry],
                ),
              ).values(),
            ].sort((a, b) => a.position - b.position),
          }));
          if (!page.hasMore) break;
          const next = page.messages[0]?.position;
          if (next === undefined || next >= (before ?? Infinity))
            throw new Error("Could not load earlier messages.");
          before = next;
        } while (!disposed);
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Could not load messages.");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [connection, supported, ready, sessionId, historyRevision, retry]);
  const entries = useMemo(
    () => mergeMessageIndex(index.revision === historyRevision ? index.entries : [], items),
    [index, historyRevision, items],
  );
  return { entries, loading, error, retry: () => setRetry((value) => value + 1) };
}
