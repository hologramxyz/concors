import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

async function expectModalLayout(page: Page, dialog: Locator, maxWidth = 36) {
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Set a viewport to verify modal bounds");
  const rem = await page
    .locator("html")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await expect
    .poll(async () => {
      const rect = await dialog.boundingBox();
      if (!rect) return false;
      return (
        Math.abs(rect.x + rect.width / 2 - viewport.width / 2) < 2 &&
        Math.abs(rect.y + rect.height / 2 - viewport.height / 2) < 2 &&
        Math.abs(rect.width - Math.min(maxWidth * rem, viewport.width - 2 * rem)) < 2 &&
        rect.y >= rem - 1 &&
        rect.y + rect.height <= viewport.height - rem + 1
      );
    })
    .toBe(true);
  await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
  await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveCSS("font-size", "15px");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCSS(
    "width",
    "28px",
  );
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}

test("pane, tab, search and form dialogs share layout and preserve pointer and keyboard actions", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-dialogs-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Dialog consistency", directory);
    const panes = page.locator("[data-pane-id]");
    const originalInput = panes.first().locator("textarea");
    await expect(originalInput).toBeFocused();
    await page.keyboard.press("Control+Shift+p");
    // Pane and tab sequences share one dialog, which names the combination that opened it.
    const shortcutActions = page.getByRole("dialog", { name: "Shortcut actions", exact: true });
    const paneDialog = shortcutActions.filter({ hasText: "Shift+P:" });
    await expectModalLayout(page, paneDialog);
    await expect(paneDialog).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("pane-shortcuts-light.png") });
    // Pointer selection must not be canceled by a global pointerdown listener.
    await paneDialog.getByRole("button", { name: /New pane to the right/ }).click();
    await expect(panes).toHaveCount(2);
    await expect(panes.last().locator("textarea")).toBeFocused();

    await page.keyboard.press("Control+Shift+t");
    const tabDialog = shortcutActions.filter({ hasText: "Shift+T:" });
    await expectModalLayout(page, tabDialog);
    await tabDialog.getByRole("button", { name: /New tab/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Agent", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await originalInput.focus();

    await page.keyboard.press("Control+Shift+p");
    await expect(paneDialog).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(paneDialog).toHaveCount(0);
    await expect(originalInput).toBeFocused();
    await page.keyboard.press("Control+Shift+p");
    await expect(paneDialog).toBeFocused();
    // Tab navigation remains inside the modal; Escape on its close button must dismiss it.
    await page.keyboard.press("Tab");
    await expect(paneDialog.getByRole("button", { name: /New pane beside current/ })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(paneDialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(originalInput).toBeFocused();

    await page.keyboard.press("Control+Shift+p");
    await expect(paneDialog).toBeVisible();
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
    await expect(paneDialog).toHaveCount(0);
    await expect(originalInput).toBeFocused();

    await page.keyboard.press("Control+Shift+k");
    const search = page.getByRole("dialog", { name: "Search", exact: true });
    await expectModalLayout(page, search);
    await expect(search.getByRole("combobox")).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("command-search-light.png") });
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
    await expectModalLayout(
      page,
      page.getByRole("dialog", { name: "Clone repository", exact: true }),
      56,
    );
    // App shortcuts must not escape an ordinary form.
    await page.keyboard.press("Control+Shift+p");
    await expect(paneDialog).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 440 });
    await originalInput.focus();
    await page.keyboard.press("Control+Shift+p");
    await expectModalLayout(page, paneDialog);
    await paneDialog.getByRole("button", { name: /Close pane/ }).scrollIntoViewIfNeeded();
    await expect(paneDialog.getByRole("button", { name: /Close pane/ })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("pane-shortcuts-narrow-dark.png") });
    await page.keyboard.press("Escape");
    await expect(originalInput).toBeFocused();
    await page.keyboard.press("Control+Shift+k");
    await expectModalLayout(page, search);
    await search.getByRole("combobox").fill("dark");
    await expect(search.getByRole("option", { name: "Dark theme", exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(search).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
