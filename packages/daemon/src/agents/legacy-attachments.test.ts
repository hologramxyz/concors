import { randomUUID } from "node:crypto";
import type { AgentInfo, AgentItem } from "@concors/protocol";
import { expect, it } from "vitest";
import { forLegacyClients } from "./legacy-attachments.ts";

const files = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `f${i}.txt`, mime: "text/plain" }));
const now = new Date().toISOString();
const item = (count: number): AgentItem => ({
  id: "prompt:1",
  sessionId: randomUUID(),
  turnId: "turn",
  position: 0,
  revision: 0,
  kind: "user",
  title: "You",
  text: "",
  detail: "",
  attachments: files(count),
  status: "completed",
  createdAt: now,
});
const agent = (count: number) =>
  ({
    id: randomUUID(),
    queue: [{ id: randomUUID(), text: "", attachments: files(count), queuedAt: now }],
  }) as AgentInfo;

it("shortens attachment lists to what older clients parse, and leaves the rest alone", () => {
  const long = forLegacyClients({ type: "agent.item", item: item(12) });
  expect(long.type === "agent.item" && long.item.attachments).toEqual(files(8));
  const short = { type: "agent.item" as const, item: item(2) };
  expect(forLegacyClients(short)).toEqual(short);
  const state = forLegacyClients({ type: "agent.state", agent: agent(5) });
  expect(state.type === "agent.state" && state.agent.queue?.[0]?.attachments).toEqual(files(3));
  const result = forLegacyClients({
    type: "agent.result",
    requestId: randomUUID(),
    outcome: {
      status: "ok",
      conversation: { agent: agent(4), items: [item(9), item(1)], hasMore: false },
    },
  });
  if (result.type !== "agent.result" || result.outcome.status !== "ok") throw new Error();
  expect(result.outcome.conversation.items.map((i) => i.attachments?.length)).toEqual([8, 1]);
  expect(result.outcome.conversation.agent.queue?.[0]?.attachments).toHaveLength(3);
  // Children of a tool item are pages of the same history.
  const children = forLegacyClients({
    type: "agent.result",
    requestId: randomUUID(),
    outcome: {
      status: "ok",
      conversation: { agent: agent(0), items: [], hasMore: false },
      childItems: [item(10)],
    },
  });
  expect(
    children.type === "agent.result" &&
      children.outcome.status === "ok" &&
      children.outcome.childItems?.[0]?.attachments,
  ).toHaveLength(8);
});
