import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { AgentsContext } from "@/agents/context";
import { TimelineItem } from "@/agents/timeline-item";
import { WorkspaceImageContext } from "@/workspace/use-project-icons";
import { withSupervisorReferences, type SupervisorReference } from "./reference-text";

const chat: SupervisorReference = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "Agent",
  label: "Game QA",
  workspace: "Star Catcher",
};
const workspace: SupervisorReference = {
  id: "00000000-0000-4000-8000-0000000000aa",
  kind: "Workspace",
  label: "Star Catcher",
};

const render = (text: string, wrap: (node: ReactNode) => ReactNode = (node) => node) =>
  renderToStaticMarkup(
    wrap(
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
    ) as never,
  );

/** Each chip's markup, from its opening tag to the next chip or the end of the message. */
const chips = (html: string) => html.split("<span data-mention").slice(1);

it("shows a chat mention and a workspace mention as chips with the @ list's marks", () => {
  const text = withSupervisorReferences("Ask @Game QA to rerun @Star Catcher tests", [
    chat,
    workspace,
  ]);
  const html = render(text, (node) =>
    createElement(
      AgentsContext,
      { value: [{ id: chat.id, provider: "claude", projectId: workspace.id } as AgentInfo] },
      createElement(
        WorkspaceImageContext,
        {
          value: (id: string) =>
            id === workspace.id ? { source: null, isGit: true, name: "Star Catcher" } : null,
        },
        node,
      ),
    ),
  );
  const [first, second] = chips(html);
  expect(chips(html)).toHaveLength(2);
  // The chat by its provider's mark, not the fallback; the workspace by its letter tile.
  expect(first).not.toContain("lucide-bot");
  expect(first).toContain("<svg");
  expect(first).toContain('<span aria-hidden="true" class="sr-only">@</span>Game QA</span>');
  expect(second).toContain('data-project-icon="initial"');
  expect(second).toContain('<span aria-hidden="true" class="sr-only">@</span>Star Catcher</span>');
  // Read as "mention, Name"; the plain text around them is untouched.
  expect(first).toContain("before:content-[&#x27;mention,_&#x27;]");
  expect(html).toContain("Ask ");
  expect(html).toContain(" to rerun ");
  expect(html).not.toContain("Concors references");
});

it("keeps the chip with the list's fallback mark when its chat or workspace is gone", () => {
  const html = render(withSupervisorReferences("Ask @Game QA in @Star Catcher", [chat, workspace]));
  const [gone, place] = chips(html);
  expect(gone).toContain("lucide-bot");
  expect(gone).toContain("Game QA");
  expect(place).toContain('data-project-icon="folder"');
});

it("leaves a message without stored references as plain text", () => {
  const html = render("Ask @Game QA to rerun the tests");
  expect(chips(html)).toHaveLength(0);
  expect(html).toContain("Ask @Game QA to rerun the tests");
});
