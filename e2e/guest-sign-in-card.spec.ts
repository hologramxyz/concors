import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, signedIn, test } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { skipSetup } from "./support/setup.ts";

/** No saved session, and a control plane that knows nobody. */
async function asGuest(page: Page) {
  await skipSetup(page);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Authentication required" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

const card = (page: Page) =>
  page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("region", { name: "Sign in to Concors" });

async function box(item: Locator) {
  const found = await item.boundingBox();
  if (!found) throw new Error("Expected it on screen");
  return found;
}

test("a guest is offered sign-in above the account row, and it opens the sign-in screen", async ({
  page,
}) => {
  await asGuest(page);
  await expect(card(page).getByText("Sign in to Concors")).toBeVisible();
  await expect(card(page).getByText("Use cloud machines and Concors on your phone.")).toBeVisible();

  const account = page.getByRole("button", { name: "Using this computer without an account" });
  const cardBox = await box(card(page));
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual((await box(account)).y);

  await card(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(card(page)).toBeVisible();
});

test("dismissing the card stays dismissed after a reload, and the account menu keeps Sign in", async ({
  page,
}) => {
  await asGuest(page);
  await card(page).getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(card(page)).toHaveCount(0);

  await page.reload();
  const account = page.getByRole("button", { name: "Using this computer without an account" });
  await expect(account).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await account.click();
  await expect(page.getByRole("menuitem", { name: "Sign in", exact: true })).toBeVisible();
});

test("the card is reached by Tab, and dismissing it leaves focus on the account row", async ({
  page,
}) => {
  await asGuest(page);
  const dismiss = card(page).getByRole("button", { name: "Dismiss", exact: true });
  await expect(dismiss).toBeVisible();
  // Start beside the card: the workspace and discovered previews can add any number of tab stops.
  const signIn = card(page).getByRole("button", { name: "Sign in", exact: true });
  await signIn.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dismiss).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(signIn).toBeFocused();
  const account = page.getByRole("button", { name: "Using this computer without an account" });
  // The iOS announcement follows this card; moving back from Sign in still reaches its dismiss.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveCount(0);
  await expect(account).toBeFocused();
});

test("the card goes away with the sidebar and comes back with it", async ({ page }) => {
  await asGuest(page);
  await expect(card(page)).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(card(page)).toBeVisible();
});

test("in the shortest window the list scrolls above the card and the account row stays", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-guest-card-"));
  try {
    await page.setViewportSize({ width: 1200, height: 600 });
    await asGuest(page);
    for (let index = 1; index <= 10; index++) {
      const folder = join(directory, String(index));
      await mkdir(folder);
      await seedProject(page, `Workspace ${index}`, folder);
    }
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const last = sidebar.getByText("Workspace 10");
    await expect(last).toBeAttached();

    const account = page.getByRole("button", { name: "Using this computer without an account" });
    const list = sidebar.locator(".overflow-y-auto").first();
    expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

    await last.scrollIntoViewIfNeeded();
    const listBox = await box(list);
    const cardBox = await box(card(page));
    const accountBox = await box(account);
    const lastBox = await box(last);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(cardBox.y);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(cardBox.y);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(accountBox.y);
    expect(accountBox.y + accountBox.height).toBeLessThanOrEqual(600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("someone signed in never sees the card, nor does anyone while their session is checked", async ({
  page,
}) => {
  await signedIn(page);
  const { promise: held, resolve: answer } = Promise.withResolvers<undefined>();
  await page.route("**/api/v1/me", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);

  answer(undefined);
  await expect(page.getByRole("button", { name: /^Account: / })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("a saved session that cannot be checked never shows the card", async ({ page }) => {
  await skipSetup(page);
  await page.addInitScript(() =>
    localStorage.setItem("concors.auth.session-token.v1", "saved-token"),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Down" } }),
  );
  await page.goto("/");
  await expect(page.getByText("Your saved session could not be checked.")).toBeVisible();
  await expect(page.getByText("Use cloud machines and Concors on your phone.")).toHaveCount(0);
});
