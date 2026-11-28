import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { AgentsContext } from "@/agents/context";
import { AgentMarkdown } from "@/agents/markdown";
import { TimelineItem } from "@/agents/timeline-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionLinkContext } from "./session-link";

const CHAT = "00000000-0000-4000-8000-000000000001";
const GONE = "00000000-0000-4000-8000-000000000009";

const supervisor = (node: ReactNode) =>
  createElement(
    SessionLinkContext,
    { value: () => undefined },
    createElement(
      AgentsContext,
      { value: [{ id: CHAT, provider: "claude" } as AgentInfo] },
      createElement(TooltipProvider, null, node),
    ),
  );

const reply = (text: string) =>
  renderToStaticMarkup(
    supervisor(
      createElement(TimelineItem, {
        live: false,
        item: {
          id: "assistant:1",
          sessionId: "00000000-0000-4000-8000-000000000002",
          turnId: "turn-1",
          position: 1,
          revision: 0,
          kind: "assistant",
          title: "Supervisor",
          text,
          detail: "",
          status: "completed",
          createdAt: "2026-11-27T10:00:00.000Z",
        },
      }),
    ) as never,
  );

/** Each button in the message's text, from its opening tag to its close (not its Copy button). */
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>.*?<\/button>/g)]
    .map((match) => match[0])
    .filter((button) => !button.includes("aria-label"));

it("shows a chat Supervisor links as its link, led by its provider's mark, still a button", () => {
  const html = reply(`**Star Catcher / [Game QA](concors://session/${CHAT})** is blocked.`);
  const [link] = buttons(html);
  expect(buttons(html)).toHaveLength(1);
  expect(link).toContain('type="button"');
  expect(link).toContain('class="text-link"');
  // The chat's own mark, not the fallback, leading the name on one line with its first word.
  expect(link).toContain("<svg");
  expect(link).not.toContain("lucide-bot");
  expect(link).toMatch(
    /<span class="whitespace-nowrap"><span data-link-icon="".*?<\/span><span class="underline underline-offset-2">Game<\/span><\/span><span class="underline underline-offset-2"> QA<\/span>/,
  );
  // Not a mention: no chip, no "@".
  expect(link).not.toContain("bg-muted");
  expect(link).not.toContain("rounded");
  expect(link).not.toContain("font-medium");
  expect(link).not.toContain("@");
});

it("leads with the fallback mark when the chat is gone", () => {
  const [link] = buttons(reply(`Ask [Old chat](concors://session/${GONE}) again.`));
  expect(link).toContain("lucide-bot");
  expect(link).toContain("Old");
  expect(link).toContain(" chat");
  expect(link).toContain('type="button"');
});

it("leaves a link inside inline code as written", () => {
  const html = reply(`Link it as \`[Game QA](concors://session/${CHAT})\`.`);
  expect(buttons(html)).toHaveLength(0);
  expect(html).toContain(`<code>[Game QA](concors://session/${CHAT})</code>`);
});

it("keeps the plain link outside a Supervisor reply, as in its notices", () => {
  const html = renderToStaticMarkup(
    supervisor(
      createElement(AgentMarkdown, {
        children: `**Star Catcher / [Game QA](concors://session/${CHAT})** finished.`,
      }),
    ) as never,
  );
  const [link] = buttons(html);
  expect(link).toContain("text-link underline");
  expect(link).not.toContain("bg-muted");
});
