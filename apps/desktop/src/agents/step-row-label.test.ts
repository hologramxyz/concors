import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { TimelineItem } from "./timeline-item";
import type { TimelineEntry } from "./thinking";

const path = "/work/concors-test/math.js";
const step = (name: "Edit" | "Write", status: AgentItem["status"]): TimelineEntry => ({
  id: `toolu-${name}`,
  sessionId: "00000000-0000-4000-8000-000000000002",
  turnId: "turn-1",
  position: 1,
  revision: 0,
  kind: "tool",
  title: "Edit files",
  text: "File changes",
  // As Claude reports them: Write says whether the file was new.
  detail: JSON.stringify({
    changes: [{ path, diff: "-a\n+b" }],
    output:
      name === "Write" ? { content: "ok", details: { type: "create", filePath: path } } : null,
  }),
  status,
  createdAt: "2026-11-24T03:20:41.689Z",
  presentation: { type: "files", fileOperation: "edit", files: [{ path, diff: "-a\n+b" }] },
  quiet: true,
});
const row = (item: TimelineEntry, live: boolean) =>
  renderToStaticMarkup(createElement(TimelineItem, { item, live })).replace(/<[^>]+>/g, " ");

describe("a step row's verb", () => {
  it("says a finished Edit edited its file, even if its copy never heard the call end", () => {
    expect(row(step("Edit", "completed"), false)).toMatch(
      /Edited\s+\/work\/concors-test\/math\.js/,
    );
    // The turn is over, so a call still marked running is not running any more.
    const stale = row(step("Edit", "running"), false);
    expect(stale).toMatch(/Edited\s+\/work\/concors-test\/math\.js/);
    expect(stale).not.toContain("Editing");
  });

  it("says a finished Write created its file", () => {
    expect(row(step("Write", "completed"), false)).toMatch(
      /Created\s+\/work\/concors-test\/math\.js/,
    );
    expect(row(step("Write", "running"), false)).not.toContain("Creating");
  });

  it("says Editing only while the turn is still on the call", () => {
    expect(row(step("Edit", "running"), true)).toContain("Editing");
  });
});
