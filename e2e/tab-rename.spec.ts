import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("double-clicking a tab renames it inline, and the name persists and syncs", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-rename-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await seedProject(page, "Renamable tabs", directory);
    const tabs = page.getByLabel("Project tabs", { exact: true });
    const labels = () => tabs.locator("[data-tab-id] > button:first-child").allTextContents();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect.poll(labels).toEqual(["Tab 1", "Tab 2"]);

    // Double-click opens an inline editor with the current name selected; Enter commits.
    await tabs.getByRole("button", { name: "Tab 2", exact: true }).dblclick();
    const editor = tabs.getByRole("textbox", { name: "Tab name", exact: true });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Tab 2");
    await page.keyboard.type("Research agent");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect.poll(labels).toEqual(["Tab 1", "Research agent"]);

    // Escape discards, an empty name is ignored, and the editor never lingers.
    await tabs.getByRole("button", { name: "Tab 1", exact: true }).dblclick();
    await page.keyboard.type("Not this");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await tabs.getByRole("button", { name: "Tab 1", exact: true }).dblclick();
    await editor.fill("   ");
    await page.keyboard.press("Enter");
    await expect.poll(labels).toEqual(["Tab 1", "Research agent"]);

    // F2 on a focused tab also renames; clicking elsewhere commits.
    await tabs.getByRole("button", { name: "Tab 1", exact: true }).focus();
    await page.keyboard.press("F2");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Shell work");
    await page.getByLabel("Project tabs", { exact: true }).click({ position: { x: 1, y: 1 } });
    await expect.poll(labels).toEqual(["Shell work", "Research agent"]);

    // Custom names survive a reload and reach another client.
    await page.reload();
    await expect.poll(labels).toEqual(["Shell work", "Research agent"]);
    await second.goto("http://localhost:1420");
    await expect(
      second
        .getByLabel("Project tabs", { exact: true })
        .getByRole("button", { name: "Research agent", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a pane is renamed from its title or its menu, and clearing the name restores the default", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-rename-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Renamable panes", directory);
    const pane = page.locator("section[data-pane-id]").first();
    const header = pane.locator("header");
    const editor = pane.getByRole("textbox", { name: "Pane name", exact: true });
    await expect(header).toContainText("Terminal");

    await header.getByText("Terminal", { exact: true }).dblclick();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Terminal");
    await page.keyboard.type("Dev server");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(header.getByText("Dev server", { exact: true })).toBeVisible();

    // The name is shared workspace state, so it survives a reload.
    await page.reload();
    await expect(header.getByText("Dev server", { exact: true })).toBeVisible();

    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Dev server");
    await editor.fill("");
    await page.keyboard.press("Enter");
    await expect(header.getByText("Terminal", { exact: true })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
