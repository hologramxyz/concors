import { test, expect } from "./fixtures";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { seedSupervisorActivity } from "../../../e2e/support/supervisor-activity-preview.ts";

test("capture mobile Supervisor activity drawer and mentions", async ({ page }) => {
  test.setTimeout(180_000);
  const cleanup = await seedSupervisorActivity(mobileDesktopSocket);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await expect(ui.getByRole("log")).toContainText("Release editor");
    const dismissAccount = ui.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    await ui.getByRole("button", { name: "Activity, 1 need you" }).click();
    const drawer = ui.getByRole("dialog", { name: "Activity" });
    await expect(drawer).toHaveAttribute("data-mobile-drawer", "true");
    await expect(drawer.getByRole("region", { name: "Needs you" })).toContainText("Game QA");
    await expect(drawer.getByRole("region", { name: "Working" })).toContainText("HUD polish");
    await expect(drawer.getByRole("region", { name: "Finished" })).toContainText("Release editor");
    await page.screenshot({
      path: test.info().outputPath("mobile-activity.png"),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: /Game QA/ }).click();
    await expect(drawer.getByText("Request details")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("mobile-approval.png"),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    const composer = ui.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Ask ");
    await ui.getByRole("button", { name: "Mention a workspace or agent" }).click();
    const picker = ui.getByRole("dialog", { name: "Mention" });
    await expect(picker).toHaveAttribute("data-mobile-drawer", "true");
    await expect(picker.getByRole("region", { name: "Agents" })).toContainText("Game QA");
    await page.screenshot({
      path: test.info().outputPath("mobile-mentions.png"),
      animations: "disabled",
    });
    await picker.getByRole("button", { name: /Game QA/ }).click();
    await expect(composer).toHaveValue("Ask ");
    await expect(ui.getByRole("button", { name: "Remove reference Game QA" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("mobile-reference.png"),
      animations: "disabled",
    });
  } finally {
    await cleanup();
  }
});
