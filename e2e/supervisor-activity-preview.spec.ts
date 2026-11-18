import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorActivity } from "./support/supervisor-activity-preview.ts";

test("Supervisor activity lists agents by status, mentions by @ and asks about approvals", async ({
  page,
}) => {
  test.setTimeout(90_000);
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

    // One row per agent, under what it needs from you.
    await page.getByRole("button", { name: "Activity, 1 need you" }).click();
    const activity = page.getByRole("complementary", { name: "Activity" });
    const needsYou = activity.getByRole("region", { name: "Needs you" });
    await expect(needsYou).toContainText("Game QA");
    await expect(needsYou).toContainText("Star Catcher · pnpm test");
    const working = activity.getByRole("region", { name: "Working" });
    await expect(working).toContainText("Review the HUD");
    await expect(working).toContainText("1 queued");
    await expect(activity.getByRole("button", { name: /HUD polish/ })).toHaveCount(1);
    await expect(activity.getByRole("region", { name: "Done" })).toContainText("Release editor");
    await expect(activity.getByRole("combobox")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("desktop-activity.png"),
      animations: "disabled",
    });

    // @ lists agents and workspaces as / lists commands, and writes the mention into the text.
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Ask @ga");
    const mentions = page.getByRole("listbox", { name: "Mention" });
    await expect(mentions.getByRole("option", { name: /Game QA/ })).toBeVisible();
    await expect(mentions.getByRole("option", { name: /HUD polish/ })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("desktop-mentions.png"),
      animations: "disabled",
    });
    await composer.press("Enter");
    await expect(mentions).toHaveCount(0);
    await expect(composer).toHaveValue("Ask @Game QA ");
    await composer.pressSequentially("about the test run");
    await page.screenshot({
      path: test.info().outputPath("desktop-reference.png"),
      animations: "disabled",
    });
    await composer.fill("");

    // Ask Supervisor drafts a question about that approval; the answer stays in the agent's chat.
    await needsYou.getByRole("button", { name: "Ask Supervisor" }).click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Should I approve @Game QA’s request “pnpm test”?");
    await composer.press("Enter");
    await expect(page.getByRole("log")).toContainText("The request is still waiting for you.");
    await expect(page.getByRole("log").locator("[data-mention]")).toHaveText("@Game QA");
    await page.screenshot({
      path: test.info().outputPath("desktop-advice.png"),
      animations: "disabled",
    });

    // A row opens its agent's chat, where the approval is answered.
    await needsYou.getByRole("button", { name: /Game QA/ }).click();
    await expect(page.getByTestId("supervisor-page")).toHaveCount(0);
    await expect(page.getByRole("log").getByText("Please approve the test command")).toBeVisible();
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByRole("button", { name: "Supervisor", exact: true }).click();
    await expect(page.getByRole("log")).toContainText(
      "The fixture test suite finished. All checks passed.",
    );
    await expect(activity.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    await expect(activity.getByRole("region", { name: "Done" })).toContainText("Game QA");
    await page.screenshot({
      path: test.info().outputPath("desktop-resolved.png"),
      animations: "disabled",
    });
  } finally {
    await cleanup();
  }
});
