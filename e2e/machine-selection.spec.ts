import { managedHost } from "./support/managed-host.ts";
import { test, expect, signedIn } from "./signed-in.ts";

test("the selected machine is highlighted and survives a reload", async ({ page }) => {
  await signedIn(page);
  await managedHost(page);
  await page.goto("/");
  const switcher = page.getByRole("button", { name: "Switch machine", exact: true });
  await expect(switcher).toContainText("This computer");

  await switcher.click();
  const localItem = page.getByRole("menuitem", { name: /This computer/ });
  await expect(localItem).toContainText(/Connected|Selected/);
  await expect(localItem.locator("svg")).toHaveClass(/text-primary/);
  await page.getByRole("menuitem", { name: /Second machine Online/i }).click();
  await expect(switcher).toContainText("Second machine");

  await switcher.click();
  const remoteItem = page.getByRole("menuitem", { name: /Second machine/ });
  await expect(remoteItem).toContainText(/Connected|Selected/);
  await expect(remoteItem.locator("svg")).toHaveClass(/text-primary/);
  await expect(page.getByRole("menuitem", { name: "This computer", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(switcher).toContainText("Second machine");
  await switcher.click();
  await expect(page.getByRole("menuitem", { name: /Second machine/ })).toContainText("Connected");
  await page.getByRole("menuitem", { name: "This computer", exact: true }).click();
  await expect(switcher).toContainText("This computer");

  await page.reload();
  await expect(switcher).toContainText("This computer");
  await switcher.click();
  await expect(page.getByRole("menuitem", { name: /This computer/ })).toContainText(
    /Connected|Selected/,
  );
});
