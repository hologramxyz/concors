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

it("shows a chat Supervisor links as a chip with its provider's mark, still a button", () => {
  const html = reply(`**Star Catcher / [Game QA](concors://session/${CHAT})** is blocked.`);
  const [chip] = buttons(html);
  expect(buttons(html)).toHaveLength(1);
  expect(chip).toContain('type="button"');
  expect(chip).toContain("bg-muted");
  expect(chip).toContain("font-medium");
  expect(chip).toContain("<svg");
  expect(chip).not.toContain("lucide-bot");
  // The link's own text, with no "@": a link to a chat, not a mention.
  expect(chip).toMatch(/<span class="\[text-box:trim-both_cap_alphabetic\]">Game QA<\/span>/);
  expect(chip).not.toContain("@");
  expect(chip).not.toContain("underline-offset-2 underline");
});

it("keeps the chip with the fallback mark when the chat is gone", () => {
  const [chip] = buttons(reply(`Ask [Old chat](concors://session/${GONE}) again.`));
  expect(chip).toContain("lucide-bot");
  expect(chip).toContain("Old chat");
  expect(chip).toContain('type="button"');
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
