import { expect, test } from "@playwright/test";

test("mobile resources show processes and require confirmation before simulated cleanup", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.locator("#mobile-sidebar-toggle").click();
  await expect(ui.getByRole("button", { name: "Processes", exact: true })).toBeVisible();
  await ui.getByRole("button", { name: "Open resources" }).click();
  const drawer = ui.getByRole("dialog", { name: "Resources", exact: true });
  await expect(drawer).toContainText("Test runner");
  await expect(drawer).toContainText("512.0 MiB RAM");
  await drawer.getByRole("button", { name: "Storage & cleanup" }).click();
  await drawer.getByRole("button", { name: "Scan storage" }).click();
  await expect(drawer).toContainText("No real files are scanned or removed");
  await drawer.getByRole("button", { name: "Review", exact: true }).last().click();
  const confirm = ui.getByRole("dialog", { name: "Remove files?" });
  await expect(confirm.getByRole("button", { name: "Remove permanently" })).toBeDisabled();
  await confirm
    .getByRole("textbox", { name: "Type the full path to confirm" })
    .fill("/tmp/demo-build");
  await confirm.getByRole("button", { name: "Remove permanently" }).click();
  await expect(drawer).toContainText("No real files were deleted");
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-resources.png" });
});
