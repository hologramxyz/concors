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

/** How far a frame keeps from the window's edges, even when its area runs up to them. */
const FRAME_INSET = 8;

// A frame may hug its area by up to a pixel, and stops short of the window's edges.
async function expectInside(outer: Locator, inner: Locator, tight: boolean, slack = 1) {
  const viewport = outer.page().viewportSize();
  await expect(async () => {
    const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
    expect(a && b && viewport).toBeTruthy();
    if (!a || !b || !viewport) return;
    const top = Math.max(a.y, FRAME_INSET);
    const left = Math.max(a.x, FRAME_INSET);
    const right = Math.min(a.x + a.width, viewport.width - FRAME_INSET);
    const bottom = Math.min(a.y + a.height, viewport.height - FRAME_INSET);
    expect(b.x).toBeLessThanOrEqual(left + slack);
    expect(b.y).toBeLessThanOrEqual(top + slack);
    expect(b.x + b.width).toBeGreaterThanOrEqual(right - slack);
    expect(b.y + b.height).toBeGreaterThanOrEqual(bottom - slack);
    if (tight) expect(b.width - a.width).toBeLessThan(24);
  }).toPass();
}

// The frame's 2px ring, and a menu's 1px border, are drawn just outside their boxes.
async function expectInWindow(page: Page, element: Locator, border: number) {
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(border);
  expect(box.y).toBeGreaterThanOrEqual(border);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - border);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - border);
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
    await expectInWindow(page, hole, FRAME_INSET - 2);
    // The frame takes in the whole split button: "+" as well as the ⌄ that opens the menu.
    if (step.target === "new-tab")
      await expectInside(hole, area.locator("xpath=preceding-sibling::button"), false, 0);
    // The frame and its 2px ring stay clear of the sidebar toggle beside Search.
    if (step.target === "search") {
      const [frame, toggle] = await Promise.all([
        hole.boundingBox(),
        page.locator('#app-sidebar button[aria-label="Collapse sidebar"]').first().boundingBox(),
      ]);
      expect(frame && toggle).toBeTruthy();
      if (frame && toggle) expect(frame.x + frame.width + 2).toBeLessThanOrEqual(toggle.x);
    }
    if ("menu" in step) {
      const menu = page.getByRole("menuitem", { name: step.menu }).first();
      await expect(menu).toBeVisible();
      await expectInside(hole, menu, false);
      await expectInWindow(page, page.getByRole("menu"), 1);
    }
    if (index === 1) {
      await current.getByRole("button", { name: "Back" }).click();
      await expect(card(page, STEPS[0].title)).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(current).toBeVisible();
    }
    // One click moves on, even with a menu open; the menu closes behind it. A person's click holds
    // the button down for a moment, during which the card must not move away.
    const last = index === STEPS.length - 1;
    if (last) await expect(current.locator("button", { hasText: "Next" })).toHaveCount(0);
    await current.locator("button", { hasText: last ? "Done" : "Next" }).click({ delay: 250 });
    // The next step may open a menu of its own straight away, so only a menu step checks.
    if ("menu" in step) await expect(page.getByRole("menu")).toHaveCount(0);
  }

  const finish = page.getByRole("dialog", { name: "You’re all set" });
  // The workspace the tour made is named like any other new one.
  await expect(page.locator('[data-tour="workspaces"]')).toContainText("Workspace 1");
  await expect(finish).toContainText("Type below to start, or click + for more.");
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

test("Take the tour is unavailable while the machine is disconnected", async ({ page }) => {
  await signedIn(page);
  let refuse = false;
  let disconnect: () => void = () => undefined;
  await page.routeWebSocket("**/ws", (client) => {
    if (refuse) {
      client.close({ code: 1011, reason: "Unavailable" });
      return;
    }
    client.connectToServer();
    disconnect = () => client.close({ code: 1001, reason: "Test reconnect" });
  });
  await page.goto("/");
  const account = page.getByRole("button", { name: "Account: E2E User" });
  const takeTour = page.getByRole("menuitem", { name: "Take the tour" });
  await account.click();
  await expect(takeTour).toBeEnabled();
  await page.keyboard.press("Escape");

  refuse = true;
  disconnect();
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting to" })).toBeVisible();
  await account.click();
  await expect(takeTour).toBeDisabled();
});
