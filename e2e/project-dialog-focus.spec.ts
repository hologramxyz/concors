import { test, expect, signedIn } from "./signed-in.ts";

test("cancelled project dialogs restore keyboard focus to their workspace menu", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open workspace menu", exact: true });
  for (const mode of ["Open folder…", "Clone repository…"] as const) {
    await trigger.click();
    await page.getByRole("menuitem", { name: mode, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    if (mode === "Open folder…") {
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } else {
      await dialog.getByRole("button", { name: "Paste a URL", exact: true }).click();
      await dialog.getByLabel("Repository URL or local path").click();
      await page.keyboard.press("Escape");
    }
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // Continue by keyboard instead of making a pointer click repair lost focus.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  const emptyStateButton = page.getByRole("main").getByRole("button", {
    name: "Open folder…",
    exact: true,
  });
  await emptyStateButton.click();
  await page.getByRole("dialog").getByLabel("Folder path", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(emptyStateButton).toBeFocused();
});
