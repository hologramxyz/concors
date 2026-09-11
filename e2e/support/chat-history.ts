import type { Page, WebSocketRoute } from "@playwright/test";
import type { AgentInfo, AgentItem } from "../../packages/protocol/src/index.ts";

/** History-only transport fixture; workspace setup, provider selection and chat rendering are real. */
export async function mockChatHistory(page: Page, url = "ws://127.0.0.1:7429/ws") {
  let count = 640;
  let revision = 0;
  let agent: AgentInfo | undefined;
  let client: WebSocketRoute | undefined;
  let paused: { direction: string; promise: Promise<void>; release: () => void } | undefined;
  let failure: string | undefined;
  const requests: { before?: number; after?: number }[] = [];
  const item = (position: number): AgentItem => ({
    id: `history-${revision}-${position}`,
    sessionId: agent?.id ?? "00000000-0000-4000-8000-000000000001",
    turnId: `history-${position}`,
    position,
    revision: 0,
    kind: "user",
    title: "You",
    text: `History ${revision} message ${position}`,
    detail: "",
    status: "completed",
    createdAt: "2026-09-11T00:00:00.000Z",
  });
  await page.routeWebSocket(url, (socket) => {
    client = socket;
    const server = socket.connectToServer();
    const reads = new Map<string, { before?: number; after?: number }>();
    const indexes = new Map<string, number | undefined>();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "agent.request" && message.operation.kind === "read") {
        const { before, after } = message.operation;
        reads.set(message.requestId, { before, after });
        requests.push({ before, after });
      }
      if (message.type === "agent.request" && message.operation.kind === "list-messages")
        indexes.set(message.requestId, message.operation.before);
      server.send(raw);
    });
    server.onMessage(async (raw) => {
      const message = JSON.parse(String(raw));
      const cursor = reads.get(message.requestId);
      if (
        indexes.has(message.requestId) &&
        message.type === "agent.result" &&
        message.outcome.status === "ok"
      ) {
        const before = indexes.get(message.requestId) ?? count;
        indexes.delete(message.requestId);
        const end = Math.min(before, count);
        const start = Math.max(0, end - 200);
        message.outcome.messageIndex = {
          messages: Array.from({ length: end - start }, (_, offset) => {
            const message = item(start + offset);
            return { id: message.id, position: message.position, preview: message.text };
          }),
          hasMore: start > 0,
        };
        message.outcome.conversation.agent.historyRevision = revision;
      }
      if (cursor && message.type === "agent.result" && message.outcome.status === "ok") {
        reads.delete(message.requestId);
        agent = { ...message.outcome.conversation.agent, historyRevision: revision };
        const all = Array.from({ length: count }, (_, position) => item(position));
        const matching = all.filter(
          (item) =>
            (cursor.before === undefined || item.position < cursor.before) &&
            (cursor.after === undefined || item.position > cursor.after),
        );
        const items = cursor.after === undefined ? matching.slice(-80) : matching.slice(0, 80);
        message.outcome.conversation = {
          agent,
          items,
          hasMore: (items[0]?.position ?? 0) > 0,
          hasNewer: (items.at(-1)?.position ?? Infinity) < count - 1,
        };
        const direction =
          cursor.before !== undefined ? "earlier" : cursor.after !== undefined ? "newer" : "latest";
        if (failure === direction) {
          failure = undefined;
          message.outcome = { status: "error", message: "History temporarily unavailable" };
        }
        if (paused?.direction === direction) {
          const pending = paused;
          paused = undefined;
          await pending.promise;
        }
      }
      socket.send(JSON.stringify(message));
    });
  });
  return {
    requests,
    failNext(direction: "earlier" | "newer") {
      failure = direction;
    },
    pauseNext(direction: "earlier" | "newer") {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      paused = { direction, promise, release };
      return release;
    },
    append() {
      if (!client || !agent) throw new Error("History fixture is not connected");
      const next = item(count++);
      client.send(JSON.stringify({ type: "agent.item", item: next }));
    },
    truncate() {
      if (!client || !agent) throw new Error("History fixture is not connected");
      count = 120;
      revision++;
      client.send(
        JSON.stringify({
          type: "agent.state",
          agent: { ...agent, revision: agent.revision + 100, historyRevision: revision },
        }),
      );
    },
  };
}
