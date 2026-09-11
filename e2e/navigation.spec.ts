import { seedProject } from "./support/projects.ts";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
const sequence = async (page: Page, prefix: "p" | "t", key: string) => {
  await page.keyboard.press(`Control+Shift+${prefix}`);
  await expect(
    page.getByRole("region", {
      name: prefix === "p" ? "Pane shortcuts" : "Tab shortcuts",
      exact: true,
    }),
  ).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Pane shortcuts", exact: true })).toBeVisible();
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
    // A terminal -> Agent -> terminal round-trip must keep navigating, not enter text selection.
    await upper.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitemradio", { name: "Agent", exact: true }).click();
    await expect(upper.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await panes.first().locator("textarea").focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Control+Shift+ArrowRight");
      await expect.poll(() => focusedPane(page)).toBe(upperId);
      await expect(upper.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await expect.poll(() => focusedPane(page)).toBe(left);
    }
    await upper
      .getByRole("textbox", { name: "Message Codex" })
      .fill("draft stays while navigating");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    await page.keyboard.press("Control+Shift+ArrowRight");
    await expect(upper.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
    await expect(upper.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
      "draft stays while navigating",
    );
    await page.keyboard.press("Control+Shift+ArrowLeft");
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
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    // At the outside edge, focus stays in the current pane.
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect.poll(() => focusedPane(page)).toBe(left);
    await sequence(page, "t", "Enter");
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await input.fill("keep these words");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("keep these words");
    expect(
      await input.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
    ).toBe(0);
    await expect(page.getByRole("region", { name: "Pane shortcuts", exact: true })).toHaveCount(0);
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
    await page.getByPlaceholder("Type a command or search…").fill("Navigation project");
    await page.getByRole("option", { name: "Navigation project", exact: true }).click();
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
