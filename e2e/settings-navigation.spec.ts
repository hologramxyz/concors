import { expect, test } from "@playwright/test";

import { signedIn } from "./signed-in.ts";

test("settings replace the app sidebar with grouped pages and return to the app", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");

  const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
  await primaryNavigation.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();

  const settingsNavigation = page.getByRole("navigation", { name: "Settings" });
  await expect(settingsNavigation).toBeVisible();
  await expect(primaryNavigation).toHaveCount(0);
  await expect(settingsNavigation.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(settingsNavigation.getByRole("region", { name: "Personal" })).toBeVisible();
  await expect(settingsNavigation.getByRole("region", { name: "Workspace" })).toBeVisible();
  await expect(settingsNavigation.getByRole("region", { name: "Developer" })).toBeVisible();

  const account = settingsNavigation.getByRole("button", { name: "Account", exact: true });
  await expect(account).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session", exact: true })).toBeVisible();

  const mainBounds = await page.getByRole("main").boundingBox();
  const profileBounds = await page
    .getByRole("heading", { name: "Profile", exact: true })
    .boundingBox();
  expect((profileBounds?.x ?? 0) - (mainBounds?.x ?? 0)).toBeLessThanOrEqual(24);

  await settingsNavigation.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator("header").getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Theme", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toHaveCount(0);

  await settingsNavigation.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(
    page.locator("header").getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent notifications" })).toBeVisible();

  await settingsNavigation.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page.locator("header").getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { name: "Billing" })).toBeVisible();

  await settingsNavigation.getByRole("button", { name: "SSH keys", exact: true }).click();
  await expect(page.locator("header").getByRole("heading", { name: "SSH keys" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { name: "SSH keys" })).toBeVisible();

  await settingsNavigation.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.locator("header").getByRole("heading", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daemon", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();

  await settingsNavigation.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(primaryNavigation).toBeVisible();
  await expect(settingsNavigation).toHaveCount(0);
});
