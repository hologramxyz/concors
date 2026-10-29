import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("closing a workspace stops its terminals and keeps it for the + menu to reopen", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-close-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closing project", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Actions for Closing project" }).click();
    const item = page.getByRole("menuitem", { name: "Close workspace…" });
    await expect(item).not.toHaveAttribute("data-variant", "destructive");
    await item.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText('Close "Closing project"?');
    await expect(dialog).toContainText("Its chats are kept. Reopen it from the + menu.");
    await expect(dialog).toContainText(/\d running terminals? will be stopped\./);
    await dialog.getByRole("button", { name: "Close workspace", exact: true }).click();
    await expect(page.getByRole("button", { name: "Closing project", exact: true })).toHaveCount(0);
    await expect(page.getByText("Unavailable workspace")).toHaveCount(0);
    await page.getByRole("button", { name: "Open workspace menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Closing project" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Closing project" }).click();
    await expect(page.getByRole("button", { name: "Closing project", exact: true })).toBeVisible();
    // Its tabs come back with it.
    await expect(page.getByLabel("Project tabs").locator("[data-tab-id]")).toHaveCount(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
