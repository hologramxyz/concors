import { expect, test } from "@playwright/test";

test.use({ actionTimeout: 15_000 });

test("direct profile sheet follows workspace shape preferences without a cloud login", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  for (const [name, radius] of [
    ["Square", 0],
    ["Rounded", 48],
    ["Slightly rounded", 24],
  ] as const) {
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await ui.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("combobox", { name: "Settings section" }).click();
    await ui.getByRole("option", { name: "Appearance", exact: true }).click();
    await settings.getByText(name, { exact: true }).click();
    await expect(settings.getByRole("radio", { name, exact: true })).toBeChecked();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await ui.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to Concors", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("profile-sheet")).toHaveCSS(
      "border-top-left-radius",
      `${radius}px`,
    );
    const fieldRadius = Number((radius * 0.4).toFixed(1));
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCSS(
      "border-radius",
      `${fieldRadius}px`,
    );
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCSS(
      "border-radius",
      `${fieldRadius}px`,
    );
    for (const label of ["Sign in", "Back to workspace"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      await expect(button).toHaveCSS("padding", "4px 8px");
      await expect(button).toHaveCSS("min-height", "46px");
    }
    await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
    await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
  }
});
