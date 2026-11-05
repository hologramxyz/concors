import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject } from "./support/projects.ts";
import { skipTour } from "./support/tour.ts";

/** No saved session, and a control plane that knows nobody. */
async function asGuest(page: Page) {
  await skipTour(page);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Authentication required" } }),
  );
  await page.goto("/");
}

test("someone with no account goes straight to work on this computer", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-guest-"));
  try {
    await asGuest(page);
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toHaveCount(0);
    await seedProject(page, "Guest work", directory);
    await expect(sidebar.getByText("Guest work")).toBeVisible();

    // It is still there after a restart, with no account in sight.
    await page.reload();
    await expect(sidebar.getByText("Guest work")).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a guest can reach sign-in, is warned what it does, and can come back", async ({ page }) => {
  await asGuest(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Using this computer without an account" }).click();
  await expect(page.getByRole("menuitem", { name: "Take the tour" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  await expect(page.getByText(/restarts any terminals and agents/)).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toHaveCount(0);
});

test("the sign-in page stays centred, and scrolls clear of the title bar when the window is short", async ({
  page,
}) => {
  await asGuest(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Sign in", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Sign in to Concors" });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  if (!box) throw new Error("No heading");
  expect(Math.abs(box.x + box.width / 2 - 680)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1000, height: 240 });
  const surface = page.getByRole("main");
  await surface.evaluate((node) => {
    node.scrollTop = 0;
  });
  const top = await surface.locator("svg").first().boundingBox();
  // The page's top padding matches the fixed title bar, where the window's controls are.
  const padding = await surface.evaluate((node) => parseFloat(getComputedStyle(node).paddingTop));
  expect(padding).toBeGreaterThan(0);
  expect(top?.y).toBeGreaterThanOrEqual(padding);
  expect(await surface.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  const notNow = page.getByRole("button", { name: "Not now" });
  await notNow.scrollIntoViewIfNeeded();
  await expect(notNow).toBeInViewport({ ratio: 1 });
});

test("what needs an account says so and offers sign-in, and the rest stays out of the way", async ({
  page,
}) => {
  await asGuest(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Using this computer without an account" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();

  // Account opens first, as it does for someone signed in.
  const account = page.getByRole("region", { name: "Account" });
  await expect(account.getByText(/without an account/)).toBeVisible();
  await expect(account.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  const settings = page.getByRole("navigation").filter({ hasText: "Machines" }).last();
  await settings.getByRole("button", { name: "Machines" }).click();
  const machines = page.getByRole("region", { name: "Machines" });
  await expect(machines.getByText(/buy a machine or connect your own server/)).toBeVisible();
  await expect(settings.getByRole("button", { name: "Billing" })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "SSH keys" })).toHaveCount(0);

  await machines.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
});

test("a guest clones by URL, since connecting GitHub belongs to an account", async ({ page }) => {
  await asGuest(page);
  await page.getByRole("button", { name: "Open workspace menu" }).click();
  await page.getByRole("menuitem", { name: /Clone/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Repository URL or local path")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /GitHub/ })).toHaveCount(0);
});

test("a saved session that cannot be checked is not treated as a guest", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("concors.auth.session-token.v1", "saved-token"),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Down" } }),
  );
  await page.goto("/");
  await expect(page.getByText("Your saved session could not be checked.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Not now" })).toHaveCount(0);
});
