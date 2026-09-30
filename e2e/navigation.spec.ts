import { seedProject } from "./support/projects.ts";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
// Pane and tab sequences share one dialog, which names the combination that opened it.
const shortcutActions = (page: Page, prefix: "p" | "t") =>
  page
    .getByRole("dialog", { name: "Shortcut actions", exact: true })
    .filter({ hasText: `Shift+${prefix.toUpperCase()}:` });
const sequence = async (page: Page, prefix: "p" | "t", key: string) => {
  await page.keyboard.press(`Control+Shift+${prefix}`);
  await expect(shortcutActions(page, prefix)).toBeVisible();
  await page.keyboard.press(key);
};
const focusedPane = (page: Page) =>
  page.evaluate(() =>
    document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
  );
test("directional pane sequences, tab cycling, project memory and immediate Agent input focus", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-navigation-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Navigation project", directory);
    await expect(page.getByRole("button", { name: "New tab", exact: true })).toBeEnabled();
    const panes = page.locator("[data-pane-id]");
    await expect(panes.locator("textarea")).toBeFocused();
    const original = await focusedPane(page);
    await page.keyboard.press("Control+Shift+p");
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          ctrlKey: true,
          shiftKey: true,
          repeat: true,
          bubbles: true,
        }),
      ),
    );
    await expect(shortcutActions(page, "p")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panes).toHaveCount(1);
    await sequence(page, "p", "ArrowLeft");
    await expect(panes).toHaveCount(2);
    await expect(panes.first().locator("textarea")).toBeFocused();
    const left = await focusedPane(page);
    expect(left).not.toBe(original);
    await page.keyboard.press("Control+Shift+ArrowRight");
    await expect.poll(() => focusedPane(page)).toBe(original);
    await sequence(page, "p", "ArrowUp");
    await expect(panes).toHaveCount(3);
    const upper = panes.nth(1);
    await expect(upper.locator("textarea")).toBeFocused();
    const upperId = await focusedPane(page);
    await page.keyboard.press("Control+Shift+ArrowDown");
    await expect.poll(() => focusedPane(page)).toBe(original);
    await page.keyboard.press("Control+Shift+ArrowUp");
    await expect.poll(() => focusedPane(page)).toBe(upperId);
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    // Navigating into an Agent pane focuses its composer, where Ctrl+Shift+Arrow selects words.
    await upper.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitemradio", { name: "Agent", exact: true }).click();
    // A closing menu hands focus back to its button when its exit animation ends, and still
    // counts as open for shortcuts until then, so let it finish before navigating by keyboard.
    await expect(page.getByRole("menu")).toHaveCount(0);
    const composer = upper.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await panes.first().locator("textarea").focus();
    await page.keyboard.press("Control+Shift+ArrowRight");
    await expect.poll(() => focusedPane(page)).toBe(upperId);
    await expect(composer).toBeFocused();
    await composer.fill("draft stays while navigating");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect(composer).toBeFocused();
    expect(
      await composer.evaluate(
        (node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart,
      ),
    ).toBeGreaterThan(0);
    await panes.first().locator("textarea").focus();
    await page.keyboard.press("Control+Shift+ArrowRight");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("draft stays while navigating");
    await panes.first().locator("textarea").focus();
    // Held directional keys may repeat; creation/close sequences may not.
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          code: "ArrowRight",
          ctrlKey: true,
          shiftKey: true,
          repeat: true,
          bubbles: true,
        }),
      ),
    );
    await expect.poll(() => focusedPane(page)).toBe(upperId);
    await panes.first().locator("textarea").focus();
    await expect.poll(() => focusedPane(page)).toBe(left);
    // At the outside edge, focus stays in the current pane.
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    await sequence(page, "t", "Enter");
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await input.fill("keep these words");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("keep these words");
    expect(
      await input.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
    ).toBeGreaterThan(0);
    await expect(shortcutActions(page, "p")).toHaveCount(0);
    // P/T sequences work directly in the composer without inserting their follow-up keys.
    await sequence(page, "p", "Escape");
    await expect(input).toHaveValue("keep these words");
    await sequence(page, "t", "ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    await sequence(page, "t", "ArrowLeft"); // wraps to the last tab
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("keep these words");
    await sequence(page, "t", "ArrowRight");
    await expect.poll(() => focusedPane(page)).toBe(left);
    // A second project must not replace this project's remembered tab or pane.
    await mkdir(join(directory, "other"));
    await seedProject(page, "Other navigation project", join(directory, "other"));
    await expect(
      page.getByRole("heading", { name: "Other navigation project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+k");
    await page.getByPlaceholder("Search workspaces, agents, tabs…").fill("Navigation project");
    await page
      .locator('[data-search-result="workspace"]')
      .filter({ hasText: /^Navigation project/ })
      .click();
    await expect.poll(() => focusedPane(page)).toBe(left);
    await expect(page.getByRole("button", { name: "Tab 1", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(page.isClosed()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
