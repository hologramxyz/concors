import { expect, test } from "@playwright/test";

test("machine picker leads directly to machine settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await ui
    .getByRole("dialog", { name: "Machine", exact: true })
    .getByRole("button", { name: "Manage machines", exact: true })
    .click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("combobox", { name: "Settings section" })).toHaveAttribute(
    "data-value",
    "machines",
  );
  await expect(settings.getByRole("button", { name: "Refresh machines" })).toBeVisible();
});

test("an account with no machines gets machine setup navigation instead of project instructions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const message = event.data?.concorsMobile;
      if (window.parent !== window && message?.type === "state") {
        message.state.machines = [];
        message.state.machineId = null;
        message.state.connectionId = null;
        message.state.phase = "idle";
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await expect(ui.getByRole("heading", { name: "Connect a machine to get started" })).toBeVisible();
  await ui.getByRole("button", { name: "Manage machines", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toContainText("No machines are available in this organization");
  await expect(settings.getByRole("button", { name: "Refresh machines" })).toBeVisible();
});
