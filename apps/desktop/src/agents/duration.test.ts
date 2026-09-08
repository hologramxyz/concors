import { expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { completedTurnFooters, formatDuration } from "./duration";
const item = (id: string, turnId: string, kind: AgentItem["kind"], text: string): AgentItem => ({
  id,
  turnId,
  kind,
  text,
  position: 0,
  revision: 0,
  sessionId: "00000000-0000-4000-8000-000000000001",
  title: "",
  detail: "",
  status: "completed",
  createdAt: "2026-09-08T00:00:00.000Z",
});
it("places each completed turn duration on its last reply, without hiding missing or failed replies", () => {
  const result = completedTurnFooters([
    item("earlier", "one", "assistant", "Interim"),
    item("final", "one", "assistant", "Final reply"),
    item("turn:one", "one", "system", "900s"),
    item("turn:unloaded", "unloaded", "system", "10s"),
    item("failed-reply", "failed", "assistant", "Partial"),
    { ...item("turn:failed", "failed", "system", "Provider error"), status: "failed" },
  ]);
  expect([...result.durations]).toEqual([["final", "15m 0s"]]);
  expect([...result.hidden]).toEqual(["turn:one"]);
});
it("formats elapsed time across minute/hour boundaries and clamps clock skew", () => {
  expect([-2, 59, 60, 3599, 3600].map(formatDuration)).toEqual([
    "0s",
    "59s",
    "1m 0s",
    "59m 59s",
    "1h 0m",
  ]);
});
