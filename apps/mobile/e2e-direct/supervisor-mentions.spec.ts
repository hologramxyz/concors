import { test, expect } from "./fixtures";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { seedSupervisorWorkspaces } from "../../../e2e/support/supervisor-fixture.ts";

test("@ mentions an agent from the phone's Supervisor message", async ({ page }) => {
  test.setTimeout(180_000);
  const cleanup = await seedSupervisorWorkspaces(mobileDesktopSocket, { delegate: false });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const dismissAccount = ui.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const composer = ui.getByRole("textbox", { name: "Message Codex", exact: true });
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
