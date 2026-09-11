import { expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { mergeMessageIndex, messageEntry } from "./message-index";
const item = (id: string, position: number, text: string): AgentItem => ({
  id,
  position,
  text,
  kind: "user",
  sessionId: "session",
  turnId: "turn",
  revision: 0,
  title: "You",
  detail: "",
  status: "completed",
  createdAt: "2026-09-11T00:00:00.000Z",
});
it("merges live prompts into the full index by stable identity, preserving chronological order", () => {
  const index = [
    messageEntry(item("old", 1, "Old prompt")),
    messageEntry(item("live", 5, "Partial")),
  ];
  expect(
    mergeMessageIndex(index, [
      item("live", 5, "Complete"),
      item("new", 9, "Newest"),
      { ...item("reply", 10, "Answer"), kind: "assistant" },
    ]),
  ).toEqual([
    { id: "old", position: 1, preview: "Old prompt" },
    { id: "live", position: 5, preview: "Complete" },
    { id: "new", position: 9, preview: "Newest" },
  ]);
});
it("previews attachment-only prompts and bounds multiline text without markup interpretation", () => {
  expect(
    messageEntry({
      ...item("image", 1, "\n"),
      attachments: [{ name: "screen.png", mime: "image/png" }],
    }).preview,
  ).toBe("screen.png");
  expect(messageEntry(item("text", 2, " <script>\n hello </script> ")).preview).toBe(
    "<script> hello </script>",
  );
  expect(messageEntry(item("long", 3, "x".repeat(300))).preview).toHaveLength(240);
});
