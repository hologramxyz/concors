import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorWorkspaces } from "./support/supervisor-fixture.ts";

test("@ in the Supervisor's message lists agents and writes the chosen mention", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cleanup = await seedSupervisorWorkspaces("ws://127.0.0.1:7429/ws", { delegate: false });
  try {
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    const dismissAccount = page.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const dismissAnnouncement = page.getByRole("button", { name: "Dismiss iOS app announcement" });
    if (await dismissAnnouncement.isVisible()) await dismissAnnouncement.click();
    // Status stays where it always was: the sidebar, beside the chat.
    await expect(page.getByRole("button", { name: /^Activity/ })).toHaveCount(0);

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
    await composer.pressSequentially("to rerun the tests");
    await page.screenshot({
      path: test.info().outputPath("desktop-mention-written.png"),
      animations: "disabled",
    });
    // Escape hides the list until something else is typed.
    await composer.fill("Then @rel");
    await expect(mentions.getByRole("option", { name: /Release editor/ })).toBeVisible();
    await composer.press("Escape");
    await expect(mentions).toHaveCount(0);
    // Not sent: the Supervisor conversation is shared by every spec on this daemon. How a sent
    // mention reads is covered by src/supervisor/sent-mentions.test.ts.
    await composer.fill("");
  } finally {
    await cleanup();
  }
});
