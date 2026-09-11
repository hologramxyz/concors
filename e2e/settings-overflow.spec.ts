import { test, expect, signedIn } from "./signed-in.ts";

test("long account details stay inside settings without horizontal scrolling", async ({ page }) => {
  const name = "Alexandria".repeat(12);
  const email = `${"contact".repeat(8)}@${"engineering.".repeat(8)}example.com`;
  const organizationName = "ProductEngineering".repeat(6);
  await signedIn(page, name);
  await page.route("**/api/v1/billing/subscriptions?*", (route) =>
    route.fulfill({ json: { subscriptions: [] } }),
  );
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "e2e-user",
          name,
          email,
          emailVerified: false,
          image: null,
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
        },
        session: {
          id: "e2e-session",
          expiresAt: "2036-01-01T00:00:00.000Z",
          activeOrganizationId: "e2e-org",
        },
      },
    }),
  );
  await page.route("**/api/v1/organizations", (route) =>
    route.fulfill({
      json: {
        organizations: [
          {
            id: "e2e-org",
            name: organizationName,
            slug: "engineering",
            logo: null,
            isPersonal: true,
            role: "owner",
            createdAt: "2026-09-07T00:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.keyboard.press("Control+Shift+Comma");
  const main = page.getByRole("main");
  await expect(main).toContainText(email);
  for (const width of [1280, 800, 640]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await main.evaluate((element) => element.scrollWidth <= element.clientWidth),
      `Settings content overflows at ${width}px`,
    ).toBe(true);
    for (const row of await main.locator("[data-settings-row]").all()) {
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    expect(
      await main
        .getByText("Email", { exact: true })
        .evaluate(
          (element) =>
            element.clientHeight <= Number.parseFloat(getComputedStyle(element).lineHeight) + 1,
        ),
      "Short field labels should not wrap letter by letter",
    ).toBe(true);
  }
  await page.screenshot({ path: "test-results/settings-long-account.png" });
});
