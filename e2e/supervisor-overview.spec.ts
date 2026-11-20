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
    // A finished session says what it produced, so it need not be opened to find out.
    const done = overview.getByRole("region", { name: "Done" });
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

    // A row opens its session, where the approval is answered; its result then reads in Done.
    await needsYou.getByRole("button", { name: /Game QA/ }).click();
    await expect(page.getByTestId("supervisor-page")).toHaveCount(0);
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByRole("button", { name: "Supervisor", exact: true }).click();
    await expect(overview.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    await expect(done).toContainText("The fixture test suite finished.");
    await page.screenshot({
      path: test.info().outputPath("desktop-overview-resolved.png"),
      animations: "disabled",
    });
  } finally {
    await cleanup();
  }
});
