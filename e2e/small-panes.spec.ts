import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

async function chatOverAnotherPane(page: Page, name: string) {
  await signedIn(page);
  await page.goto("/");
  const directory = await mkdtemp(join(tmpdir(), "concors-small-panes-"));
  await seedProject(page, name, directory);
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
  await chooseProvider(page);
  const pane = page.locator("[data-pane-id]").filter({ visible: true }).first();
  await expect(pane.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  return { directory, pane };
}

async function splitVertically(page: Page) {
  await page.getByRole("button", { name: "Pane actions", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Split vertically", exact: true }).click();
  const handle = page.getByRole("separator", { name: "Resize split" });
  await expect(handle).toBeVisible();
  return handle;
}

async function dragDividerTo(page: Page, handle: Locator, y: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("No split handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** What a pane shows, by what a person could actually see of it. */
const look = (pane: Locator) =>
  pane.evaluate((root) => {
    const seen = (element: Element | null | undefined) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const area = element.getBoundingClientRect();
      return style.visibility === "visible" && area.width > 0 && area.height > 0;
    };
    const outer = root.getBoundingClientRect();
    const form = root.querySelector("form")?.getBoundingClientRect();
    return {
      height: Math.round(outer.height),
      chips: seen(root.querySelector('[aria-label="Start with"]')),
      icon: seen(root.querySelector(".start-heading-icon")),
      heading: seen(root.querySelector(".start-heading h2")),
      composerWhole: !!form && form.top >= outer.top && form.bottom <= outer.bottom + 0.5,
      belowComposer: form ? Math.round(outer.bottom - form.bottom) : -1,
    };
  });

test("a short start screen gives up chips, then icon, then heading, and keeps the composer whole", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { directory, pane } = await chatOverAnotherPane(page, "Short start");
  try {
    const handle = await splitVertically(page);
    const notice = pane.getByRole("button", { name: /dismiss/i });
    if (await notice.count()) await notice.first().click();
    const seen: Awaited<ReturnType<typeof look>>[] = [];
    for (let y = 780; y >= 60; y -= 40) {
      await dragDividerTo(page, handle, y);
      const state = await look(pane);
      seen.push(state);
      const where = `pane ${state.height}px tall`;
      // Above about 110px the composer is whole with nothing to scroll.
      if (state.height >= 120) expect(state.composerWhole, where).toBe(true);
      // Each goes only once the one before it has.
      if (state.chips) expect(state.icon, where).toBe(true);
      if (state.icon) expect(state.heading, where).toBe(true);
      if (!state.chips) expect(state.belowComposer, where).toBeLessThanOrEqual(16);
    }
    const heights = (key: "chips" | "icon" | "heading") =>
      seen.filter((state) => state[key]).map((state) => state.height);
    // Every stage really happened, in order, and the shortest panes hold only the composer.
    expect(Math.min(...heights("chips"))).toBeGreaterThan(Math.min(...heights("icon")));
    expect(Math.min(...heights("icon"))).toBeGreaterThan(Math.min(...heights("heading")));
    expect(seen.at(-1)).toMatchObject({ chips: false, icon: false, heading: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("notices above a short composer scroll, and nothing is out of reach", async ({ page }) => {
  const { directory, pane } = await chatOverAnotherPane(page, "Short notices");
  try {
    await expect(pane.getByText("Connect your ChatGPT account")).toBeVisible();
    const handle = await splitVertically(page);
    await dragDividerTo(page, handle, 190);
    const state = await look(pane);
    expect(state.composerWhole).toBe(true);
    const signIn = pane.getByRole("button", { name: "Sign in with ChatGPT" });
    await signIn.scrollIntoViewIfNeeded();
    await expect(signIn).toBeInViewport();
    expect((await look(pane)).composerWhole).toBe(true);
    await pane.locator("form").scrollIntoViewIfNeeded();
    expect((await look(pane)).composerWhole).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a short pane with an existing chat scrolls its messages above a whole composer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { directory, pane } = await chatOverAnotherPane(page, "Short chat");
  try {
    const composer = pane.getByRole("textbox", { name: "Message Codex" });
    for (const message of ["first message", "second message", "third message"]) {
      await composer.fill(message);
      await page.keyboard.press("Enter");
      await expect(pane.getByRole("log", { name: "Chat timeline" })).toContainText(message);
      await expect(composer).toBeEnabled();
    }
    const handle = await splitVertically(page);
    const timeline = pane.getByRole("log", { name: "Chat timeline" });
    for (const y of [400, 260, 200, 170]) {
      await dragDividerTo(page, handle, y);
      const state = await look(pane);
      expect(state.composerWhole, `pane ${state.height}px tall`).toBe(true);
      const room = await timeline.evaluate((log) => ({
        shown: log.clientHeight,
        scrolls: log.scrollHeight > log.clientHeight,
      }));
      expect(room.shown, `pane ${state.height}px tall`).toBeGreaterThanOrEqual(30);
      expect(room.scrolls).toBe(true);
    }
    // The oldest message is still there to scroll to, with the composer still in place.
    await pane.getByText("first message").first().scrollIntoViewIfNeeded();
    await expect(pane.getByText("first message").first()).toBeInViewport();
    expect((await look(pane)).composerWhole).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the wheel over a short pane's composer scrolls the pane, unless a long draft takes it", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);
  const { directory, pane } = await chatOverAnotherPane(page, "Short wheel");
  try {
    const handle = await splitVertically(page);
    const top = (await pane.boundingBox())?.y ?? 0;
    await dragDividerTo(page, handle, top + 85);
    const conversation = pane.locator(".agent-conversation");
    const composer = pane.getByRole("textbox", { name: "Message Codex" });
    const form = pane.locator("form");
    await page.evaluate(() => {
      window.addEventListener("wheel", (event) => {
        document.documentElement.dataset["wheelHandled"] = String(event.defaultPrevented);
      });
    });
    const paneScroll = () => conversation.evaluate((element) => element.scrollTop);
    const box = await composer.boundingBox();
    if (!box) throw new Error("No composer");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Part of the composer starts out of view, and scrolling over it brings its bottom edge in.
    const bottomEdgeShows = async () => {
      const [outer, inner] = await Promise.all([pane.boundingBox(), form.boundingBox()]);
      return !!outer && !!inner && inner.y + inner.height <= outer.y + outer.height + 0.5;
    };
    expect(await bottomEdgeShows()).toBe(false);
    await page.mouse.wheel(0, 200);
    await expect.poll(bottomEdgeShows).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-wheel-handled", "true");
    await page.mouse.wheel(0, -200);
    await expect.poll(paneScroll).toBe(0);

    // Playwright's WebKit passes a synthetic wheel over a long draft to the pane; the real one
    // scrolls the draft, so this half is only meaningful in Chromium.
    if (browserName !== "chromium") return;
    await composer.fill("line\n".repeat(12));
    await composer.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.mouse.wheel(0, 40);
    await expect.poll(() => composer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await paneScroll()).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the agent chips show whole or not at all", async ({ page }) => {
  test.setTimeout(60_000);
  const { directory, pane } = await chatOverAnotherPane(page, "Chip row");
  try {
    // By label, not role: once hidden the row has no role to find it by.
    const chips = pane.locator('[aria-label="Start with"]');
    await expect(chips).toBeVisible();
    const first = chips.locator("button").first();
    await page.getByRole("button", { name: "Pane actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    const handle = page.getByRole("separator", { name: "Resize split" });
    await handle.focus();
    let sawHidden = false;
    for (let step = 0; step < 8; step++) {
      const state = await chips.evaluate((row) => {
        const area = row.getBoundingClientRect();
        const space = row.closest(".start-space")?.getBoundingClientRect();
        return {
          visible: getComputedStyle(row).visibility === "visible",
          inside:
            !!space &&
            area.left >= space.left &&
            area.right <= space.right &&
            area.bottom <= space.bottom + 0.5,
          oneRow:
            new Set([...row.children].map((chip) => Math.round(chip.getBoundingClientRect().top)))
              .size === 1,
        };
      });
      expect(state.oneRow).toBe(true);
      if (state.visible) expect(state.inside).toBe(true);
      else {
        sawHidden = true;
        // Out of sight is out of the Tab order too.
        await expect(first).toBeHidden();
      }
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(150);
    }
    expect(sawHidden).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the sign-in notice says one short thing, and loses it where it would pass two lines", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { directory, pane } = await chatOverAnotherPane(page, "Notice text");
  try {
    const notice = pane.getByRole("region", { name: "Codex account connection" });
    const body = notice.locator(".account-prompt-body");
    await expect(body).toHaveText("Use your account on this machine.");
    await expect(notice).not.toContainText("You can dismiss");
    await page.getByRole("button", { name: "Pane actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    const handle = page.getByRole("separator", { name: "Resize split" });
    await handle.focus();
    const seen = new Set<boolean>();
    for (let step = 0; step < 9; step++) {
      const shown = await body.isVisible();
      seen.add(shown);
      if (shown) {
        const lines = await body.evaluate((text) => {
          const range = document.createRange();
          range.selectNodeContents(text);
          return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
        });
        expect(lines).toBeLessThanOrEqual(2);
      }
      await expect(notice.getByText("Connect your ChatGPT account")).toBeVisible();
      await expect(notice.getByRole("button", { name: "Sign in with ChatGPT" })).toBeVisible();
      await expect(
        notice.getByRole("button", { name: "Dismiss account connection" }),
      ).toBeVisible();
      await handle.focus();
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(150);
    }
    expect([...seen].sort()).toEqual([false, true]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dismissing a sign-in notice hides it in every pane and tab, for that provider only", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { directory } = await chatOverAnotherPane(page, "Notice dismissal");
  try {
    await page.getByRole("button", { name: "Pane actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    await expect(panes).toHaveCount(2);
    const notices = page.getByRole("region", { name: "Codex account connection" });
    await expect(notices).toHaveCount(2);

    await notices.first().getByRole("button", { name: "Dismiss account connection" }).click();
    await expect(notices).toHaveCount(0);

    // A tab opened afterwards, and a restart, remember it.
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await expect(panes.first().getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(notices).toHaveCount(0);
    await page.reload();
    await expect(panes.first().getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(notices).toHaveCount(0);

    // Claude's notice is its own question.
    const composer = panes.first();
    await composer.getByRole("button", { name: "Agent and model", exact: true }).click();
    await page.getByRole("button", { name: "Back to providers", exact: true }).click();
    await page
      .getByRole("option", {
        name: "Claude Code",
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: "Fixture claude model", exact: true }).click();
    const claude = page.getByRole("region", { name: "Claude Code account connection" });
    await expect(claude).toBeVisible();
    await claude.getByRole("button", { name: "Dismiss account connection" }).click();
    await expect(claude).toHaveCount(0);

    // No link stays behind above the composer: the model menu is the way back.
    await expect(page.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
    await expect(composer.locator(".chat-prompts")).toBeHidden();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
