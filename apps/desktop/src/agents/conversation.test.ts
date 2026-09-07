import { expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { mergeItems } from "./conversation";
const item = (id: string, position: number, revision: number, text: string): AgentItem => ({
  id,
  position,
  revision,
  text,
  sessionId: "00000000-0000-4000-8000-000000000001",
  turnId: "turn",
  kind: "assistant",
  title: "Codex",
  detail: "",
  status: "completed",
  createdAt: "2026-09-07T00:00:00.000Z",
});
it("keeps streamed updates newer than a page read and inserts older history in order", () => {
  const streamed = item("reply", 4, 2, "complete");
  expect(
    mergeItems([streamed], [item("reply", 4, 1, "partial"), item("earlier", 1, 0, "old")]),
  ).toEqual([item("earlier", 1, 0, "old"), streamed]);
  expect(mergeItems([streamed], [{ ...streamed, revision: 3, text: "final" }])).toHaveLength(1);
  expect(mergeItems([streamed], [{ ...streamed, revision: 3, text: "final" }])[0]?.text).toBe(
    "final",
  );
});
