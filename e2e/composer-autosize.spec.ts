import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("the composer grows, shrinks and rewraps drafts without losing focus", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-composer-sizing-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Composer sizing", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    const height = () => composer.evaluate((el) => el.getBoundingClientRect().height);

    await composer.fill("short draft");
    const minimum = await composer.evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
    await expect.poll(height).toBeCloseTo(minimum, 0);
    const initial = await height();
    await composer.fill("one line\n".repeat(8));
    await expect.poll(height).toBeGreaterThan(initial + 80);
    await expect(composer).toBeFocused();

    // The final empty line needs its own room, just like a line containing a character.
    await composer.fill("first\nsecond\n");
    const threeLines = await composer.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        3 * parseFloat(style.lineHeight) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth)
      );
    });
    await expect.poll(async () => Math.abs((await height()) - threeLines)).toBeLessThanOrEqual(1);
    await composer.fill("first\nsecond\nthird");
    await expect.poll(async () => Math.abs((await height()) - threeLines)).toBeLessThanOrEqual(1);

    await composer.fill("a long draft\n".repeat(50));
    expect(await composer.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const conversation = page.locator('[aria-label="Agent conversation"]');
    const room = await conversation.evaluate((el) => el.getBoundingClientRect().height);
    await expect.poll(height).toBeCloseTo(Math.min(room * 0.4, 416), 0);
    expect(await height()).toBeLessThanOrEqual(Math.min(room * 0.4, 416) + 1);

    // Stay below the height cap so a narrower pane can visibly add a wrapped line.
    await composer.fill("words that wrap ".repeat(10));
    await expect.poll(height).toBeLessThan(Math.min(room * 0.4, 416) - 40);
    const wide = await height();
    await page.setViewportSize({ width: 640, height: 850 });
    await expect.poll(height).toBeGreaterThan(wide);
    await page.setViewportSize({ width: 1360, height: 850 });
    await expect.poll(height).toBe(wide);
    await expect(composer).toBeFocused();

    await composer.fill("");
    await expect.poll(height).toBe(initial);
    await expect(composer).toBeFocused();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
