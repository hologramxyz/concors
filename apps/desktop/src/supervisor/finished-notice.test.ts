import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentItem } from "@concors/protocol";
import { AgentsContext } from "@/agents/context";
import { TimelineItem } from "@/agents/timeline-item";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupervisorReferences } from "./reference-context";
import type { SupervisorReference } from "./reference-text";
import { SessionLinkContext } from "./session-link";
import {
  FINISHED_TITLE,
  finishedNotice,
  finishedRuns,
  finishedWord,
  quoteImages,
  quotePreview,
} from "./finished-notice";
import { markFailureSeen } from "@/agents/seen-updates";
import type { TimelineEntry } from "@/agents/thinking";

const SUPERVISOR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

function notice(text: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:done`,
    sessionId: SUPERVISOR,
    turnId: "supervisor:watch-1",
    position: 0,
    revision: 0,
    kind: "system",
    title: FINISHED_TITLE,
    text,
    detail: "",
    status: "completed",
    createdAt: "2026-11-24T00:00:00.000Z",
    origin: { supervisorId: SUPERVISOR, deliveryId: "watch-1" },
    ...overrides,
  };
}

const sentence = (word = "finished") =>
  `**Star Catcher / [Game QA](concors://session/${CHAT})** ${word}.`;
const haiku = "Maple leaves let go\ndrifting on the cooling wind\ndusk arrives sooner";
const quoted = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

describe("finishedNotice", () => {
  it("reads a reply under the label, keeping its line breaks", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n${quoted(`Saved it:\n\n${haiku}`)}`;
    expect(finishedNotice(notice(text))).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: `Saved it:\n\n${haiku}`,
      cut: false,
    });
  });

  it("reads a notice without a reply as the row alone", () => {
    const text = `${sentence()}\n\nNo final text reply was saved. Open the chat for its tool output.`;
    expect(finishedNotice(notice(text))).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: null,
      cut: false,
    });
  });

  it("tells a reply the daemon cut short", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n> Part one\n\nRead the original chat for the full reply.`;
    expect(finishedNotice(notice(text))).toMatchObject({ quote: "Part one", cut: true });
  });

  it("reads a failed chat's error, quoted with no label", () => {
    const text = `${sentence("failed")}\n\n> Provider exited with code 1`;
    const item = notice(text, { id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:failed` });
    expect(finishedNotice(item)).toEqual({
      sessionId: CHAT,
      state: "failed",
      quote: "Provider exited with code 1",
      cut: false,
    });
  });

  it("reads an interrupted chat, with or without a reply", () => {
    const id = `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:interrupted`;
    const none = `${sentence("interrupted")}\n\nNo final text reply was saved. Open the chat for its tool output.`;
    expect(finishedNotice(notice(none, { id }))).toMatchObject({
      state: "interrupted",
      quote: null,
    });
    const reply = `${sentence("interrupted")}\n\nAgent’s reply:\n\n> Halfway`;
    expect(finishedNotice(notice(reply, { id }))).toMatchObject({ quote: "Halfway" });
  });

  it("names each ending as a step's row does", () => {
    expect(["done", "failed", "interrupted"].map((s) => finishedWord(s as never))).toEqual([
      "Finished",
      "Failed",
      "Stopped",
    ]);
  });

  describe("leaves to the notice as written", () => {
    const text = `${sentence()}\n\nAgent’s reply:\n\n> Done.`;
    it.each([
      ["another title", notice(text, { title: "Input no longer pending" })],
      ["a message that is not Supervisor's", notice(text, { origin: undefined })],
      ["not a system line", notice(text, { kind: "assistant" })],
      ["an ID with no ending", notice(text, { id: `supervisor-watch:${SUPERVISOR}:${CHAT}` })],
      ["an ID with an unknown ending", notice(text, { id: `supervisor-watch:a:${CHAT}:t:paused` })],
      ["a sentence for another ending", notice(text.replace("finished.", "failed."))],
      ["a sentence linking another chat", notice(text.replace(CHAT, "someone-else"))],
      ["no body", notice(sentence())],
      ["a reply that is not quoted", notice(`${sentence()}\n\nAgent’s reply:\n\nDone.`)],
      ["an empty reply", notice(`${sentence()}\n\nAgent’s reply:\n\n> `)],
      ["text after the reply", notice(`${text}\n\nSomething else.`)],
      ["other wording", notice(`${sentence()}\n\nNo reply was saved.`)],
    ])("%s", (_, item) => expect(finishedNotice(item)).toBeNull());
  });
});

/**
 * The daemon's own watcher, given just enough of a store to post its notices: the client must
 * still read what it writes when a watched chat's turn ends, and a change to its wording fails
 * here. It is loaded by path at run time, as in answered-notice.test.ts.
 */
describe("the daemon's finished notice", () => {
  interface Watches {
    track(supervisorId: string, sessionId: string, id: string): void;
    observe(event: unknown): void;
  }
  type WatchesClass = new (
    store: unknown,
    agents: unknown,
    source: (id: string) => unknown,
    target: (id: string) => unknown,
    delivering: () => boolean,
    selected: () => Set<string>,
  ) => Watches;

  async function ended(after: object, reply?: string) {
    const path = new URL("../../../../packages/daemon/src/supervisor/watch.ts", import.meta.url)
      .href;
    const { SupervisorWatches } = (await import(/* @vite-ignore */ path)) as {
      SupervisorWatches: WatchesClass;
    };
    const records = new Map<string, unknown>();
    const items = new Map<string, AgentItem>();
    const agent = (id: string, extra: object = {}) => ({
      id,
      projectId: "project-1",
      name: "Game QA",
      status: "working",
      turnId: "turn-1",
      pending: [],
      ...extra,
    });
    let target = agent(CHAT);
    const store = {
      keepAgents: () => undefined,
      supervisorRecord: (key: string) => records.get(key),
      supervisorRecords: (prefix: string) =>
        [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value),
      saveSupervisorRecord: (key: string, value: unknown) => records.set(key, value),
      agentItem: (_: string, id: string) => items.get(id),
      agent: (id: string) => (id === CHAT ? target : agent(id)),
      agentTurnItems: () => (reply === undefined ? [] : [{ kind: "assistant", text: reply }]),
      snapshot: () => ({ projects: [{ id: "project-1", name: "Star Catcher" }] }),
    };
    const agents = {
      recordSupervisorUpdate: (_: string, item: AgentItem) => items.set(item.id, item),
    };
    const watches = new SupervisorWatches(
      store,
      agents,
      (id) => agent(id),
      () => target,
      () => false,
      () => new Set([SUPERVISOR]),
    );
    watches.track(SUPERVISOR, CHAT, "watch-1");
    target = agent(CHAT, after);
    watches.observe({ type: "agent.state", agent: target });
    return [...items.values()].find((item) => item.title === FINISHED_TITLE);
  }

  it("is read with its reply, line breaks and all", async () => {
    const item = await ended({ status: "done" }, `I saved this haiku:\n\n${haiku}`);
    expect(item).toBeDefined();
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: `I saved this haiku:\n\n${haiku}`,
      cut: false,
    });
  });

  it("is read without a reply", async () => {
    const item = await ended({ status: "done" });
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "done",
      quote: null,
      cut: false,
    });
  });

  it("is read with a reply the daemon cut short", async () => {
    const item = await ended({ status: "done" }, "word ".repeat(1000));
    expect(finishedNotice(item!)).toMatchObject({ cut: true });
    expect(finishedNotice(item!)?.quote).toHaveLength(3000);
  });

  it("is read when the chat failed, with its error", async () => {
    const item = await ended({ status: "failed", error: "Provider exited with code 1" });
    expect(finishedNotice(item!)).toEqual({
      sessionId: CHAT,
      state: "failed",
      quote: "Provider exited with code 1",
      cut: false,
    });
  });

  it("is read when the chat was interrupted", async () => {
    const item = await ended({ status: "interrupted" });
    expect(finishedNotice(item!)).toMatchObject({ state: "interrupted", quote: null });
  });
});

describe("the finished row", () => {
  const known = [
    { id: CHAT, kind: "Agent", label: "Game QA", workspace: "Star Catcher" },
  ] as SupervisorReference[];
  const chatState = (more: Partial<AgentInfo> = {}) =>
    ({ id: CHAT, provider: "codex", pending: [], ...more }) as unknown as AgentInfo;
  const agent = chatState();
  const render = (item: TimelineEntry, agents: AgentInfo[] = [agent]) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          AgentsContext,
          { value: agents },
          createElement(
            SessionLinkContext,
            { value: () => undefined },
            createElement(
              SupervisorReferences,
              { value: known },
              createElement(TimelineItem, { item, live: false }),
            ),
          ),
        ),
      ),
    );
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("counts a reply's images instead of showing each as missing", () => {
    const one = render(
      notice(`${sentence()}\n\nAgent’s reply:\n\n${quoted("Here it is:\n![Chart](chart.png)")}`),
    );
    expect(one).not.toContain("Image not available");
    expect(text(one)).toBe("Star Catcher / Game QA Finished Here it is: 1 image in the chat");
    const only = render(
      notice(`${sentence()}\n\nAgent’s reply:\n\n${quoted("![a](a.png) ![b](b.png)")}`),
    );
    expect(only).not.toContain("data-finished-quote");
    expect(text(only)).toBe("Star Catcher / Game QA Finished 2 images in the chat");
  });

  const reply = (text: string) =>
    render(notice(`${sentence()}\n\nAgent’s reply:\n\n${quoted(text)}`));

  it("folds a long reply to two lines of its text, its blocks read as lines", () => {
    const html = reply(
      "Fixed the HUD.\n\n## Changes\n\n- Score counter\n- Pause menu\n\n```ts\nhud.layout();\n```\n\nThe pause menu still needs a look.",
    );
    expect(html).toContain("line-clamp-2");
    for (const block of ["<pre", "<h2", "<ul", "<li"]) expect(html).not.toContain(block);
    expect(text(html)).toBe(
      "Star Catcher / Game QA Finished Fixed the HUD. Changes Score counter Pause menu hud.layout(); The pause menu still needs a look.",
    );
    expect(html).toContain("<code>hud.layout();</code>");
    // The copy button copies the reply as written, not the folded lines.
    expect(html).toContain('aria-label="Copy quote"');
  });

  it("shows a short reply whole, with nothing to open", () => {
    const html = reply("Done. All 48 tests pass.");
    expect(text(html)).toBe("Star Catcher / Game QA Finished Done. All 48 tests pass.");
    expect(html).not.toContain("aria-expanded");
  });

  it("folds a reply that is only a code block to its lines as inline code", () => {
    const html = reply("```sh\npnpm install\npnpm test --filter game\npnpm build\n```");
    expect(html).not.toContain("<pre");
    expect(html).toContain("<code>pnpm install</code><br/>");
    expect(html).toContain("<code>pnpm test --filter game</code>");
  });

  it("keeps a finished or stopped turn on one quiet line, with no action", () => {
    const done = render(notice(`${sentence()}\n\nAgent’s reply:\n\n> All good.`));
    expect(text(done)).toBe("Star Catcher / Game QA Finished All good.");
    const stopped = render(
      notice(
        `${sentence("interrupted")}\n\nNo final text reply was saved. Open the chat for its tool output.`,
        {
          id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-1:interrupted`,
        },
      ),
    );
    expect(text(stopped)).toBe("Star Catcher / Game QA Stopped");
    expect(done).not.toContain("text-destructive");
  });

  const failure = (turn = 1) =>
    notice(`${sentence("failed")}\n\n> Provider exited with code 1`, {
      id: `supervisor-watch:${SUPERVISOR}:${CHAT}:turn-${turn}:failed`,
    });
  const failedChat = (updatedAt = "2026-11-24T10:00:00.000Z") =>
    chatState({ status: "failed", updatedAt });

  it("puts Failed first in the block, in the error colour, then the error, then Open chat", () => {
    const html = render(failure(), [failedChat()]);
    expect(text(html)).toBe("Star Catcher / Game QA Failed Provider exited with code 1 Open chat");
    expect(html).toMatch(/text-destructive">Failed</);
    expect(html).not.toContain("bg-destructive"); // no attention dot
  });

  it.each([
    ["a later result of its chat", { finishedLater: true as const }, () => [failedChat()]],
    ["its chat working again", {}, () => [chatState({ status: "working" })]],
    ["its chat finishing since", {}, () => [chatState({ status: "done" })]],
    ["a chat the app no longer lists", {}, () => []],
    [
      "its chat being opened",
      {},
      () => {
        const seen = failedChat("2026-11-24T11:00:00.000Z");
        markFailureSeen(seen);
        return [seen];
      },
    ],
  ])(
    "is a quiet row after %s: Failed small in the error colour, its error in two lines",
    (_, extra, agents) => {
      const html = render({ ...failure(), ...extra }, agents());
      expect(text(html)).toBe("Star Catcher / Game QA Failed Provider exited with code 1");
      expect(html).toMatch(/text-xs text-destructive">Failed</);
      expect(html).toContain("line-clamp-2");
      expect(html).not.toContain("font-semibold");
      // One line of error fits: nothing to open.
      expect(html).not.toContain("aria-expanded");
      expect(html).not.toContain("Open chat");
    },
  );

  it("keeps the block while a newer failure of the same chat is still unseen", () => {
    const seen = failedChat("2026-11-24T12:00:00.000Z");
    markFailureSeen(seen);
    const html = render(failure(), [failedChat("2026-11-24T13:00:00.000Z")]);
    expect(text(html)).toContain("Open chat");
  });
});

describe("quotePreview", () => {
  it("keeps each line's words and drops the blocks around them", () => {
    expect(
      quotePreview("# Title\n\n- one\n* [x] two\n\n1. first\n2) second\n\n> quoted\n\n---\nlast"),
    ).toBe(["Title", "one", "two", "1\\. first", "2\\) second", "quoted", "last"].join("  \n"));
  });

  it("reads a code block's lines as inline code, fenced past their own backticks", () => {
    expect(quotePreview("```sh\npnpm test\n\nrun `x`\n```")).toBe("`pnpm test`  \n`` run `x` ``");
  });

  it("reads a table's rows as their cells", () => {
    expect(quotePreview("| Page | State |\n| --- | :-: |\n| Levels | Two broken links |")).toBe(
      "Page | State  \nLevels | Two broken links",
    );
  });

  it("keeps links, emphasis and inline code as written", () => {
    expect(quotePreview("See [the notes](https://example.com), **now**, in `notes.md`.")).toBe(
      "See [the notes](https://example.com), **now**, in `notes.md`.",
    );
  });
});

describe("quoteImages", () => {
  it("takes a reply's images out and counts them", () => {
    expect(quoteImages("Before\n![Chart](out/chart.png)\nAfter")).toEqual({
      text: "Before\nAfter",
      images: 1,
    });
    expect(quoteImages('See ![a](<a b.png> "A") and ![](b.png).')).toEqual({
      text: "",
      images: 2,
    });
  });

  it("leaves no stray fragment where an image sat in a sentence, and keeps all real text", () => {
    // The fixture's reply: "And ." would be all that is left of its second sentence.
    expect(
      quoteImages(
        "Here is the page:\n\n![The pricing page](shot.png)\n\nAnd ![a missing one](gone.png).",
      ),
    ).toEqual({ text: "Here is the page:", images: 2 });
    expect(quoteImages("Done. And here is ![it](a.png). Ship it?")).toEqual({
      text: "Done. Ship it?",
      images: 1,
    });
    expect(
      quoteImages("The header in ![shot](a.png) still overlaps the logo ![b](b.png)."),
    ).toEqual({
      text: "The header in still overlaps the logo.",
      images: 2,
    });
    expect(quoteImages("- See ![a](a.png) for the layout")).toEqual({
      text: "- See for the layout",
      images: 1,
    });
  });

  it("leaves images in a code block as text, and a reply with none as it was", () => {
    const code = "```md\n![x](x.png)\n```";
    expect(quoteImages(code)).toEqual({ text: code, images: 0 });
    expect(quoteImages(haiku)).toEqual({ text: haiku, images: 0 });
  });
});

describe("finishedRuns", () => {
  const reply = { ...notice("Done."), id: "reply", title: "Codex", kind: "assistant" as const };
  const ended = (turn: number, status = "failed", chat = CHAT) =>
    notice(`${sentence(status === "done" ? "finished" : status)}\n\n> Out of credits`, {
      id: `supervisor-watch:${SUPERVISOR}:${chat}:turn-${turn}:${status}`,
    });
  const later = (view: TimelineEntry[]) => finishedRuns(view).map((entry) => !!entry.finishedLater);

  it("leaves only each chat's most recent result able to ask for a person", () => {
    expect(later([ended(1), ended(2, "done"), ended(3)])).toEqual([true, true, false]);
  });

  it("looks past other rows and other chats' results", () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    const other = {
      ...ended(2),
      id: `supervisor-watch:${SUPERVISOR}:${OTHER}:turn-2:failed`,
      text: `**Star Catcher / [HUD](concors://session/${OTHER})** failed.\n\n> Out of credits`,
    };
    expect(later([ended(1), reply, other])).toEqual([false, false, false]);
    expect(later([ended(1), other, ended(3)])).toEqual([true, false, false]);
  });

  it("keeps every notice in its place", () => {
    const view = [ended(1), reply, ended(2)];
    expect(finishedRuns(view).map((entry) => entry.id)).toEqual(view.map((entry) => entry.id));
  });
});
