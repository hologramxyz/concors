import { expect, test } from "@playwright/test";

test("mobile keeps previews in the sidebar and process inspection in computer Resources", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.locator("#mobile-sidebar-toggle").click();
  const sidebar = ui.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
  await expect(sidebar).not.toContainText("Test runner");
  const preview = sidebar.getByRole("button", { name: "Open preview: Dev server", exact: true });
  await expect(preview).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Add preview" })).toHaveCount(0);
  await expect(ui.getByRole("dialog", { name: /preview/i })).toHaveCount(0);
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = preview.click();
  const dialog = await dialogPromise;
  const confirmation = dialog.message();
  await dialog.dismiss();
  await clickPromise;
  expect(confirmation).toContain("preview-5173.example.invalid");
  expect(confirmation).not.toContain("access_token");
  await page.screenshot({ path: "test-results/mobile-previews-sidebar.png" });
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  const machine = ui.getByRole("dialog", { name: "Machine", exact: true });
  await machine.getByRole("button", { name: "Resources", exact: true }).click();
  const drawer = ui.getByRole("dialog", { name: "Resources", exact: true });
  await expect(drawer).toContainText("Test runner");
  await expect(drawer).toContainText("512.0 MiB RAM");
  await expect(drawer.getByRole("button", { name: "Scan storage" })).toHaveCount(0);
  await expect(drawer).not.toContainText("Storage & cleanup");
  const rows = drawer.getByRole("list", { name: "Running processes" });
  await expect(rows.locator("details[open]")).toHaveCount(0);
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await rows.locator("summary").filter({ hasText: "Test runner" }).click();
  await rows.getByRole("button", { name: /^Stop Test runner/ }).click();
  const stop = ui.getByRole("dialog", { name: "Stop process?" });
  await expect(stop).toContainText("Child processes can remain");
  await stop.getByRole("button", { name: "Cancel" }).click();
  await expect(drawer).toContainText("Test runner");
  await page.screenshot({ path: "test-results/mobile-resources.png" });
});
