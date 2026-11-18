import { test, expect } from "./fixtures";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { seedSupervisorActivity } from "../../../e2e/support/supervisor-activity-preview.ts";

test("phone Supervisor activity drawer and @ mentions", async ({ page }) => {
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
    await expect(drawer.getByRole("region", { name: "Done" })).toContainText("Release editor");
    await page.screenshot({
      path: test.info().outputPath("mobile-activity.png"),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "Ask Supervisor" }).click();
    await expect(drawer).toHaveCount(0);
    const composer = ui.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(composer).toHaveValue("Should I approve @Game QA’s request “pnpm test”?");
    // The drawer hands focus to the message, which opens to show the whole question.
    await expect(composer).toBeFocused();
    await page.screenshot({
      path: test.info().outputPath("mobile-ask.png"),
      animations: "disabled",
    });
    await composer.fill("Ask @ga");
    await expect(ui.getByRole("listbox", { name: "Mention" })).toContainText("Game QA");
    await page.screenshot({
      path: test.info().outputPath("mobile-mentions.png"),
      animations: "disabled",
    });
    await ui.getByRole("option", { name: /Game QA/ }).click();
    await expect(composer).toHaveValue("Ask @Game QA ");
  } finally {
    await cleanup();
  }
});
