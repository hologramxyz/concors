import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

const STEPS = [
  { target: "workspaces", title: "Workspaces" },
  { target: "tabs", title: "Tabs and panes" },
  { target: "new-tab", title: "Start agents here", menu: "New chat" },
  { target: "schedules", title: "Schedules and pull requests" },
  { target: "search", title: "Search" },
  { target: "machines", title: "This computer, or the cloud", menu: "This computer" },
] as const;

// While the tour holds a menu open, the menu hides everything else from the accessibility tree,
// so steps are found by their text rather than by role.
const card = (page: Page, title: string) =>
  page.locator('[role="dialog"]').filter({ has: page.getByText(title, { exact: true }) });

async function expectInside(outer: Locator, inner: Locator, tight: boolean) {
  await expect(async () => {
    const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    expect(b.x).toBeLessThanOrEqual(a.x);
    expect(b.y).toBeLessThanOrEqual(a.y);
    expect(b.x + b.width).toBeGreaterThanOrEqual(a.x + a.width);
    expect(b.y + b.height).toBeGreaterThanOrEqual(a.y + a.height);
    if (tight) expect(b.width - a.width).toBeLessThan(24);
  }).toPass();
}

test("welcomes a new device, sets up a workspace, and tours each area for real", async ({
  page,
}) => {
  await signedIn(page, undefined, undefined, { freshTour: true });
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "Welcome to Concors" });
  await expect(welcome).toContainText("Welcome to Concors, E2E");
  await expect(welcome).toContainText("on your computer");
  // A stray click on the dimmed window keeps the tour.
  await page.mouse.click(20, 20);
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Take the tour" }).click();

  // With no workspace, the tour makes the default one so tabs and New tab exist to show.
  const hole = page.locator("[data-tour-hole]");
  for (const [index, step] of STEPS.entries()) {
    const current = card(page, step.title);
    await expect(current).toContainText(`${index + 1} of ${STEPS.length}`, { timeout: 15_000 });
    const area = page.locator(`[data-tour="${step.target}"]:visible`).first();
    await expectInside(hole, area, !("menu" in step));
    if ("menu" in step) {
      const menu = page.getByRole("menuitem", { name: step.menu }).first();
      await expect(menu).toBeVisible();
      await expectInside(hole, menu, false);
    }
    if (index === 1) {
      await current.getByRole("button", { name: "Back" }).click();
      await expect(card(page, STEPS[0].title)).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(current).toBeVisible();
    }
    // One click moves on, even with a menu open; the menu closes behind it. A person's click holds
    // the button down for a moment, during which the card must not move away.
    await current.locator("button", { hasText: "Next" }).click({ delay: 250 });
    await expect(page.getByRole("menu")).toHaveCount(0);
  }

  const finish = page.getByRole("dialog", { name: "You’re all set" });
  await expect(page.locator('[data-tour="workspaces"]')).toContainText("Default workspace");
  // Naming it waits for its terminal, which a rename mid-start would make the daemon refuse.
  await expect(page.getByText("Pane changed on another client")).toHaveCount(0);
  await expect(finish).toContainText("then choose Agent");
  await finish.getByRole("button", { name: "Start using Concors" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(hole).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "New tab", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Welcome to Concors" })).toHaveCount(0);

  // Replaying skips the welcome; Escape ends it.
  await page.getByRole("button", { name: "Account: E2E User" }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(card(page, STEPS[0].title)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Skip is remembered, and Search replays the tour", async ({ page }) => {
  await signedIn(page, undefined, undefined, { freshTour: true });
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "Welcome to Concors" });
  await welcome.getByRole("button", { name: "Skip" }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open workspace menu" })).toBeVisible();
  await expect(welcome).toHaveCount(0);

  await page.keyboard.press("Control+Shift+k");
  const search = page.getByRole("dialog", { name: "Search", exact: true });
  await search.getByRole("combobox").fill("tour");
  await search.getByRole("option", { name: "Take the tour" }).click();
  const first = card(page, STEPS[0].title);
  await expect(first).toBeVisible({ timeout: 15_000 });
  await first.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
