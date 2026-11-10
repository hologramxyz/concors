import { expect, test } from "@playwright/test";

// Capture the public mobile surfaces in both appearances. Native SwiftUI drawing and the software
// keyboard still require device acceptance; the same bridge has separate interaction coverage.
test.use({ deviceScaleFactor: 1 });
for (const colorScheme of ["light", "dark"] as const) {
  test(`visual audit of mobile pages and drawers in ${colorScheme}`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.addEventListener("message", (event) => {
        const message = event.data?.concorsMobile;
        if (window.parent !== window && message?.type === "state")
          message.state.safeArea = { top: 59, bottom: 34, left: 0, right: 0 };
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Explore demo" })).toBeVisible();
    const capture = async (name: string) => {
      await page.screenshot({
        path: test.info().outputPath(`${colorScheme}-${name}.png`),
        animations: "disabled",
        // Metro's refresh badge is development chrome outside the product UI.
        style: ".__expo_fast_refresh { visibility: hidden !important; }",
      });
    };
    await capture("welcome");
    await page.getByRole("button", { name: "Explore demo" }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const input = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeVisible();
    await capture("chat-approval");
    await ui.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(ui.locator(".mobile-composer-primary button")).toHaveAttribute(
      "aria-label",
      "Start dictation",
    );
    await capture("chat-idle");
    await input.fill("Review this layout before sending.");
    await capture("composer-expanded");
    await ui.getByRole("button", { name: "Agent and model", exact: true }).click();
    await capture("model-picker");
    await page.keyboard.press("Escape");
    await input.fill("");
    await ui.getByRole("button", { name: "Browse your messages", exact: true }).click();
    await capture("message-history");
    await page.keyboard.press("Escape");
    await ui.getByRole("button", { name: /^Workspace: / }).click();
    await capture("workspaces");
    await page.keyboard.press("Escape");
    await ui.getByRole("button", { name: "New tab", exact: true }).click();
    await capture("new-tab");
    await page.keyboard.press("Escape");
    await ui.getByRole("button", { name: "Project files", exact: true }).click();
    await capture("files-capability");
    await ui.getByRole("button", { name: "Back to chat", exact: true }).click();
    await ui.locator(".mobile-tab-strip [data-pane-choice]").nth(1).click();
    await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
    await capture("terminal");
    await ui.locator("#mobile-sidebar-toggle").click();
    await capture("sidebar");
    await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
    await capture("search");
    await page.keyboard.press("Escape");
    await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
    await capture("machines");
    await ui.getByRole("button", { name: "Resources", exact: true }).click();
    await expect(ui.getByRole("dialog", { name: "Resources", exact: true })).toContainText(
      "Test runner",
    );
    await capture("resources");
    await page.keyboard.press("Escape");
    await ui.locator("#mobile-sidebar-toggle").click();
    await ui.getByRole("button", { name: /^Account:/ }).click();
    await capture("account");
    await ui.getByRole("combobox", { name: "Organization", exact: true }).click();
    await capture("organizations");
    await page.keyboard.press("Escape");
    await ui.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    for (const section of [
      "Account",
      "Appearance",
      "Shortcuts",
      "Notifications",
      "Machines",
      "Subscriptions",
      "MCP servers",
      "Plugins",
      "SSH keys",
      "About",
    ]) {
      await settings.getByRole("combobox", { name: "Settings section", exact: true }).click();
      await ui.getByRole("option", { name: section, exact: true }).click();
      await settings.locator(".mobile-settings-body").evaluate((el) => {
        el.scrollTop = 0;
      });
      if (section === "Subscriptions") {
        await expect(settings.getByText("Connecting…", { exact: true })).toHaveCount(0);
        await expect(settings).toContainText(
          "Update this machine’s Concors service to manage subscriptions.",
        );
      }
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        expect(
          await settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          `${section} at ${width}px`,
        ).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(`settings-${section.toLowerCase().replaceAll(" ", "-")}`);
    }
    await page.keyboard.press("Escape");
    const openPage = async (name: string) => {
      await ui.locator("#mobile-sidebar-toggle").click();
      await ui
        .getByRole("dialog", { name: "Workspace sidebar" })
        .getByRole("button", { name, exact: true })
        .first()
        .click();
    };
    await openPage("Schedules");
    await expect(ui.getByText("Morning review")).toBeVisible();
    await capture("schedules");
    await ui.getByRole("button", { name: "New schedule", exact: true }).click();
    await capture("schedule-form");
    await openPage("Pull requests");
    await expect(ui.getByText("Keep the composer at the bottom of the screen")).toBeVisible();
    await capture("pull-requests");
    await ui.getByText("Keep the composer at the bottom of the screen").click();
    await capture("pull-request-detail");
    expect(errors).toEqual([]);
  });
}
