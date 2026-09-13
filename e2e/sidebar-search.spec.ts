import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { searchWorkspace } from "./support/search-workspace.ts";

test("compact sidebar search opens Search beside the collapse control", async ({ page }) => {
  await signedIn(page);
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const search = sidebar.getByRole("button", { name: "Search", exact: true });
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  const collapseBox = await sidebar.getByRole("button", { name: "Collapse sidebar" }).boundingBox();
  if (!searchBox || !collapseBox) throw new Error("Sidebar controls are missing");
  expect(searchBox.y).toBe(collapseBox.y);
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(collapseBox.x);
  await expect(page.getByText("Search or jump to…", { exact: true })).toHaveCount(0);
  await search.click();
  await expect(page.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("Search finds duplicate workspaces, ranks tabs and focuses the exact agent or terminal pane", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await searchWorkspace("ws://127.0.0.1:7429/ws");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await expect(page.locator(`[data-pane-id="${fixture.otherPaneId}"]`)).toBeVisible();
    const opener = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Search", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Search", exact: true });
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("desktop-search.png") });
    await expect(dialog.getByRole("heading", { name: "Command palette" })).toHaveCount(0);
    await expect(dialog).toContainText("not messages or file contents");
    await input.fill("Search Hologram");
    await dialog.getByRole("button", { name: "Workspaces", exact: true }).click();
    const workspaces = dialog.locator('[data-search-result="workspace"]');
    await expect(workspaces).toHaveCount(2);
    await expect(workspaces.nth(0)).toContainText("frontend");
    await expect(workspaces.nth(1)).toContainText("backend");
    await input.fill("no-such-search-result");
    await expect(dialog.getByRole("status")).toHaveText("No results.");
    await input.press("Escape");
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(input).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await input.fill("build terminal");
    const terminal = dialog.locator(
      `[data-search-result="pane"][data-search-pane-id="${fixture.terminalId}"]`,
    );
    await expect(terminal).toContainText("Build review · 2");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(fixture.terminalId);
    await opener.click();
    await input.fill("Codex");
    await dialog
      .locator(`[data-search-result="pane"][data-search-pane-id="${fixture.chatId}"]`)
      .click();
    const chat = page
      .locator(`[data-pane-id="${fixture.chatId}"]`)
      .getByRole("textbox", { name: "Message Codex" });
    await expect(chat).toBeFocused();
    await chat.fill("Keep this draft when navigating with Search");
    await opener.click();
    await input.fill("Release notes");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await input.press("Enter");
    await expect(page.locator(`[data-pane-id="${fixture.otherPaneId}"]`)).toBeVisible();
    await opener.click();
    await input.fill("Codex");
    await input.press("Enter");
    await expect(chat).toHaveValue("Keep this draft when navigating with Search");
    await opener.click();
    await input.fill("Release notes");
    await fixture.execute({
      kind: "tab.rename",
      projectId: fixture.projectId,
      expectedVersion: fixture.project().version,
      tabId: fixture.otherTabId,
      name: "Shipping checklist",
    });
    await expect(dialog.getByRole("status")).toHaveText("No results.");
    await input.fill("Shipping checklist");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await fixture.execute({
      kind: "tab.close",
      projectId: fixture.projectId,
      expectedVersion: fixture.project().version,
      tabId: fixture.otherTabId,
    });
    await expect(dialog.getByRole("status")).toHaveText("No results.");
    await input.fill("Shortcuts");
    await dialog.getByRole("option", { name: /Shortcuts/ }).click();
    await expect(page.getByRole("heading", { name: "Shortcuts", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});
