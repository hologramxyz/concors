import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TimelineItem } from "@/agents/timeline-item";
import { withSupervisorReferences } from "./reference-text";

it("shows a sent message's mentions in place, without its reference metadata", () => {
  const text = withSupervisorReferences("Ask @Game QA to rerun the tests", [
    {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "Agent",
      label: "Game QA",
      workspace: "Star Catcher",
    },
  ]);
  const html = renderToStaticMarkup(
    createElement(TimelineItem, {
      live: false,
      item: {
        id: "prompt:1",
        sessionId: "00000000-0000-4000-8000-000000000002",
        turnId: "turn-1",
        position: 1,
        revision: 0,
        kind: "user",
        title: "You",
        text,
        detail: "",
        status: "completed",
        createdAt: "2026-11-18T10:00:00.000Z",
      },
    }),
  );
  expect(html).toContain('<span class="font-medium" data-mention="true">@Game QA</span>');
  expect(html).toContain("Ask ");
  expect(html).toContain(" to rerun the tests");
  expect(html).not.toContain("Concors references");
});
