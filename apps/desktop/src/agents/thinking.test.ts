import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { thinkingExpandable, thinkingPreview, thinkingText, timelineView } from "./thinking";

const item = (id: string, extra: Partial<AgentItem> = {}): AgentItem => ({
  id,
  sessionId: "session",
  turnId: "turn",
  position: 0,
  revision: 0,
  kind: "tool",
  title: "Thinking",
  text: "",
  detail: "",
  status: "completed",
  createdAt: "2026-09-23T00:00:00.000Z",
  ...extra,
});
const thinking = (id: string, text: string, turnId = "turn") =>
  item(id, { text, turnId, presentation: { type: "thinking" } });

describe("thinking rows", () => {
  it("separates Codex summary headings and previews the latest one", () => {
    const text = "**Planning autonomous commits****Assessing commit grouping**";
    expect(thinkingText(text)).toBe(
      "**Planning autonomous commits**\n\n**Assessing commit grouping**",
    );
    expect(thinkingText("**A**\n**B**")).toBe("**A**\n\n**B**");
    expect(thinkingPreview(text)).toBe("Assessing commit grouping");
    expect(thinkingExpandable(text)).toBe(true);
    expect(thinkingExpandable("**Inspecting the router**")).toBe(false);
  });

  it("hides empty summaries and earlier copies, and folds adjacent steps", () => {
    const view = timelineView([
      thinking("msg:thinking:1", "**Checking the routes**"),
      thinking("msg:thinking:0", "**Checking the routes**"),
      thinking("encrypted", "  "),
      thinking("next", "**Reading the config**"),
      item("shell", { title: "Run command" }),
      thinking("after", "**Verifying**"),
      thinking("other-turn", "**Checking the routes**", "other"),
    ]);
    expect(view.map((entry) => [entry.id, entry.text])).toEqual([
      ["msg:thinking:0", "**Checking the routes**\n\n**Reading the config**"],
      ["shell", ""],
      ["after", "**Verifying**"],
      ["other-turn", "**Checking the routes**"],
    ]);
  });

  it("hides a prompt saved again after its turn completed", () => {
    const view = timelineView([
      item("prompt", { kind: "user", turnId: "first" }),
      item("turn:first", { kind: "system", turnId: "first", text: "693s" }),
      item("prompt-2", { kind: "user", turnId: "second" }),
      item("replayed", { kind: "user", turnId: "first" }),
    ]);
    expect(view.map((entry) => entry.id)).toEqual(["prompt", "turn:first", "prompt-2"]);
  });
});
