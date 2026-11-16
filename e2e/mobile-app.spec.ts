import { expect, signedIn, test } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { skipSetup } from "./support/setup.ts";

const APP_STORE_URL = "https://apps.apple.com/us/app/concors-agent-orchestrator/id6817622624";

test.use({ colorScheme: "dark", reducedMotion: "reduce" });

test("the sidebar offers the iOS app with a QR code and opens the App Store outside the workspace", async ({
  page,
  context,
}) => {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "Concors", process.cwd());
  const card = page.getByRole("region", { name: "Concors for iOS" });
  await expect(card).toBeVisible();
  const trigger = card.getByRole("button", { name: "Get the iOS app" });
  await page.screenshot({ path: test.info().outputPath("sidebar.png") });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Your agents, on your phone." });
  await expect(dialog.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(dialog).toContainText("Add a machine in the desktop app");
  await page.screenshot({ path: test.info().outputPath("qr-dialog.png") });

  await context.route("https://apps.apple.com/**", (route) => route.fulfill({ body: "App Store" }));
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Open in App Store" }).click();
  const store = await popup;
  await expect(store).toHaveURL(APP_STORE_URL);
  await store.close();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("dismissal persists, leaves keyboard focus on the footer, and the account menu keeps the QR code", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Concors for iOS" });
  await card.getByRole("button", { name: "Dismiss iOS app announcement" }).click();
  const account = page.getByRole("button", { name: "Account: E2E User" });
  await expect(account).toBeFocused();
  await page.reload();
  await expect(account).toBeVisible();
  await expect(card).toHaveCount(0);
  await account.click();
  await page.getByRole("menuitem", { name: "Get the iOS app" }).click();
  const dialog = page.getByRole("dialog", { name: "Your agents, on your phone." });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open in App Store" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(account).toBeFocused();
});

test("guests can find the iOS app without signing in, even in a short window", async ({ page }) => {
  await skipSetup(page);
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: {} }));
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Concors for iOS" });
  await expect(card).toBeInViewport();
  await card.getByRole("button", { name: "Dismiss iOS app announcement" }).click();
  await page.getByRole("button", { name: "Using this computer without an account" }).click();
  await page.getByRole("menuitem", { name: "Get the iOS app" }).click();
  await expect(page.getByRole("dialog", { name: "Your agents, on your phone." })).toBeVisible();
});
