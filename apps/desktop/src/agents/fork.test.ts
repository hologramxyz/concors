import { expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { forkReplies } from "./fork";
const item = (id: string, turnId: string, kind: AgentItem["kind"]): AgentItem => ({
  id,
  turnId,
  kind,
  text: id,
  position: 0,
  revision: 0,
  sessionId: "00000000-0000-4000-8000-000000000001",
  title: "",
  detail: "",
  status: "completed",
  createdAt: "2026-10-19T00:00:00.000Z",
});
it("offers forking on each turn's last reply only", () => {
  expect(
    forkReplies([
      item("prompt-one", "one", "user"),
      item("interim", "one", "assistant"),
      item("tool", "one", "tool"),
      item("final", "one", "assistant"),
      item("prompt-two", "two", "user"),
      item("reply", "two", "assistant"),
      item("prompt-three", "three", "user"),
    ]),
  ).toEqual(new Set(["final", "reply"]));
});
