import { expect as baseExpect, test } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15000 });
test.setTimeout(120000);

test("settings choices use nested drawers, preserve the parent and reset section scroll", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  const body = settings.locator(".mobile-settings-body");
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const section = settings.getByRole("combobox", { name: "Settings section" });
  await section.click();
  const sections = ui.getByRole("dialog", { name: "Settings section", exact: true });
  await expect(sections).toHaveAttribute("data-mobile-drawer", "true");
  await sections.getByRole("option", { name: "Appearance", exact: true }).click();
  await expect(body).toHaveJSProperty("scrollTop", 0);
  const theme = settings.getByRole("combobox", { name: "Theme", exact: true });
  await theme.click();
  const themes = ui.getByRole("dialog", { name: "Theme", exact: true });
  await expect(themes).toHaveAttribute("data-mobile-drawer", "true");
  await themes.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(ui.locator("html")).toHaveClass(/dark/);
  await expect(settings).toBeVisible();
  await expect(theme).toBeFocused();
  await section.click();
  await sections.getByRole("option", { name: "Shortcuts", exact: true }).click();
  await settings.getByRole("combobox", { name: "Follow-ups", exact: true }).click();
  const followups = ui.getByRole("dialog", { name: "Follow-ups", exact: true });
  await expect(followups).toHaveAttribute("data-mobile-drawer", "true");
  await followups.getByRole("option", { name: "Queue for after the turn" }).click();
  await expect(settings.getByRole("combobox", { name: "Follow-ups" })).toContainText(
    "Queue for after the turn",
  );
  await section.click();
  await sections.getByRole("option", { name: "Notifications", exact: true }).click();
  const sounds = settings.getByRole("checkbox", { name: "Agent sounds" });
  const wasChecked = await sounds.isChecked();
  await sounds.setChecked(!wasChecked);
  if (wasChecked) await expect(sounds).not.toBeChecked();
  else await expect(sounds).toBeChecked();
  await expect(sounds).toBeEnabled();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await section.click();
  await sections.getByRole("option", { name: "Subscriptions", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Update your machine" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Add subscription", exact: true })).toHaveCount(
    0,
  );
  await section.click();
  await sections.getByRole("option", { name: "MCP servers", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Add server", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("heading", { name: "Update your machine" })).toBeVisible();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Explore demo" }).click();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  await section.click();
  await sections.getByRole("option", { name: "Shortcuts", exact: true }).click();
  await expect(settings.getByRole("combobox", { name: "Follow-ups" })).toContainText(
    "Queue for after the turn",
  );
});

test("schedule field drawers preserve the form and support rich-label typeahead", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Schedules", exact: true }).click();
  await ui.getByRole("button", { name: "New schedule", exact: true }).click();
  const form = ui.getByRole("form", { name: "New schedule", exact: true });
  await form.getByLabel("Name", { exact: true }).fill("Keep this schedule draft");
  await form.getByRole("combobox", { name: "Workspace", exact: true }).click();
  const workspace = ui.getByRole("dialog", { name: "Workspace", exact: true });
  await expect(workspace).toHaveAttribute("data-mobile-drawer", "true");
  await workspace.getByRole("option", { name: /Concors/ }).press("c");
  await expect(workspace.getByRole("option", { name: /Concors/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await form.getByRole("combobox", { name: "Repeat", exact: true }).click();
  const repeat = ui.getByRole("dialog", { name: "Repeat", exact: true });
  await repeat.getByRole("option", { name: "Weekly", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "Repeat", exact: true })).toContainText("Weekly");
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Keep this schedule draft");
  await expect(form).toBeVisible();
});
