import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";

test("new tab menu creates a named terminal only after choosing a profile", async ({ page }) => {
  await signedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add project", exact: true }).first().click();
  await page.getByLabel("Project name", { exact: true }).fill("Profile controls");
  await page.getByLabel("Folder on this machine").fill("/tmp");
  await page.getByRole("dialog").getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  for (const name of ["Terminal", "Unified chat", "Codex", "Claude Code", "OpenCode"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Project tabs").locator("[data-tab-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "Create a tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configure terminal profile…" }).click();
  await page.getByLabel("Tab name", { exact: true }).fill("Development");
  await page.getByLabel("Terminal profile", { exact: true }).selectOption("shell");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Development", exact: true })).toBeVisible();
  await expect(page.getByLabel("Terminal output")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start terminal", exact: true })).toHaveCount(0);
  const tab = page.getByLabel("Project tabs").locator("[data-tab-id]");
  const bounds = await tab.boundingBox();
  expect(bounds?.height).toBeLessThanOrEqual(25);
  await page.getByLabel("Terminal output").click();
  await page.keyboard.type("printf 'configured-session\\n'");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Terminal output")).toContainText("configured-session");
  await page.screenshot({ path: "test-results/project-controls.png" });
});
