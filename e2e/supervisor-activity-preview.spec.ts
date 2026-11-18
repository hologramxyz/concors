import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorActivity } from "./support/supervisor-activity-preview.ts";

test("capture desktop Supervisor activity, request and mentions", async ({ page }) => {
  const cleanup = await seedSupervisorActivity("ws://127.0.0.1:7429/ws");
  try {
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    await expect(page.getByRole("log")).toContainText("Release editor");
    const previews = page.getByRole("button", { name: "Previews", exact: true });
    if (await previews.isVisible()) await previews.click();
    const dismissAccount = page.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const dismissAnnouncement = page.getByRole("button", { name: "Dismiss iOS app announcement" });
    if (await dismissAnnouncement.isVisible()) await dismissAnnouncement.click();
    await page.getByRole("button", { name: "Activity, 1 need you" }).click();
    const activity = page.getByRole("complementary", { name: "Activity" });
    await expect(activity.getByRole("region", { name: "Needs you" })).toContainText("Game QA");
    await expect(activity.getByRole("region", { name: "Working" })).toContainText("HUD polish");
    await expect(activity.getByRole("region", { name: "Finished" })).toContainText(
      "Release editor",
    );
    const filter = activity.getByRole("combobox", { name: "Filter by workspace" });
    await filter.selectOption({ label: "Release Notes" });
    await expect(activity.getByText("Game QA")).toHaveCount(0);
    await filter.selectOption({ label: "All workspaces" });
    await page.screenshot({
      path: test.info().outputPath("desktop-activity.png"),
      animations: "disabled",
    });
    await activity.getByRole("button", { name: /Game QA/ }).click();
    await expect(activity.getByText("Request details")).toBeVisible();
    await expect(activity.getByRole("button", { name: "Open agent chat" })).toBeVisible();
    await expect(activity.locator("details")).not.toHaveAttribute("open");
    await page.screenshot({
      path: test.info().outputPath("desktop-approval.png"),
      animations: "disabled",
    });
    await activity.getByRole("button", { name: "Close activity" }).click();
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Ask ");
    await page.getByRole("button", { name: "Mention a workspace or agent" }).click();
    const picker = page.getByRole("dialog", { name: "Mention" });
    await expect(picker.getByRole("region", { name: "Workspaces" })).toContainText("Star Catcher");
    await expect(picker.getByRole("region", { name: "Agents" })).toContainText("Game QA");
    await page.screenshot({
      path: test.info().outputPath("desktop-mentions.png"),
      animations: "disabled",
    });
    await picker.getByRole("textbox").fill("qa");
    await expect(picker.getByRole("button", { name: /HUD polish/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /Game QA/ }).click();
    await expect(composer).toHaveValue("Ask @Game QA (Star Catcher) ");
    await page.getByRole("button", { name: "Activity, 1 need you" }).click();
    await activity.getByRole("button", { name: /Game QA/ }).click();
    await activity.getByRole("button", { name: "Open agent chat" }).click();
    await expect(page.getByTestId("supervisor-page")).toHaveCount(0);
    await expect(page.getByRole("log").getByText("Please approve the test command")).toBeVisible();
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByRole("button", { name: "Supervisor", exact: true }).click();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(activity.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    await expect(activity.getByRole("region", { name: "Finished" })).toContainText("Game QA");
  } finally {
    await cleanup();
  }
});
