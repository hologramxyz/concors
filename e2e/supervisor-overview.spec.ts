import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorWorkspaces } from "./support/supervisor-fixture.ts";

test("Overview shows each session's status, what it needs, and the gist of its output", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The agents get their work directly: the Supervisor conversation is shared by later specs.
  const cleanup = await seedSupervisorWorkspaces("ws://127.0.0.1:7429/ws", {
    delegate: false,
    work: true,
  });
  try {
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    const dismissAccount = page.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const dismissAnnouncement = page.getByRole("button", { name: "Dismiss iOS app announcement" });
    if (await dismissAnnouncement.isVisible()) await dismissAnnouncement.click();

    await page.getByRole("button", { name: "Overview, 1 need you" }).click();
    const overview = page.getByRole("complementary", { name: "Overview" });
    const needsYou = overview.getByRole("region", { name: "Needs you" });
    await expect(needsYou).toContainText("Game QA");
    await expect(needsYou).toContainText("Approve: pnpm test");
    const working = overview.getByRole("region", { name: "In progress" });
    await expect(working).toContainText("HUD polish");
    // A working session shows its latest update as it streams, refreshed while it works.
    await expect(working).toContainText("Hello from");
    // Done starts folded to its header, which shows the rows' dot for a finish nobody opened.
    const done = overview.getByRole("region", { name: "Done" });
    const doneToggle = done.getByRole("button", { name: "Done", exact: true });
    const headerDot = done.locator("[data-header-unseen]");
    await expect(doneToggle).toHaveAttribute("aria-expanded", "false");
    await expect(done.getByRole("button", { name: /Release editor/ })).toBeHidden();
    await expect(headerDot).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("desktop-overview-done-folded.png"),
      animations: "disabled",
    });
    // Its header opens it, and the open group's rows carry the dot instead.
    await doneToggle.click();
    await expect(doneToggle).toHaveAttribute("aria-expanded", "true");
    await expect(headerDot).toHaveCount(0);
    await expect(done.getByRole("button", { name: /Release editor/ })).toBeVisible();
    // A finished session says what it produced, so it need not be opened to find out.
    await expect(done).toContainText("Release editor");
    await expect(done).toContainText("Hello from Codex");
    await page.screenshot({
      path: test.info().outputPath("desktop-overview.png"),
      animations: "disabled",
    });

    // Ask Supervisor drafts the question; it is not sent, as later specs share this conversation.
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await needsYou.getByRole("button", { name: "Ask Supervisor" }).click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Should I approve @Game QA’s request “pnpm test”?");
    await composer.fill("");

    // The approval is answered on its row, as in its chat; its result then reads in Done.
    await needsYou.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(page.getByTestId("supervisor-page")).toBeVisible();
    await expect(overview.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    await expect(done).toContainText("The fixture test suite finished.");
    await page.screenshot({
      path: test.info().outputPath("desktop-overview-resolved.png"),
      animations: "disabled",
    });

    // A row opens its session.
    await done.getByRole("button", { name: /Game QA/ }).click();
    await expect(page.getByTestId("supervisor-page")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
