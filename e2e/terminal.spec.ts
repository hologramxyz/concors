import { test, expect } from "@playwright/test";

test("two devices use the same terminal and recover its screen after reload", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext();
  const second = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/");
    await second.goto("http://localhost:1420");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Terminal acceptance");
    await page.getByLabel("Folder on this machine").fill(process.cwd());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("button", { name: "Start terminal", exact: true }).click();
    await expect(second.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Take control", exact: true }).click();
    await page.keyboard.type("printf 'hello-%s\\n' shared-terminal");
    await page.keyboard.press("Enter");
    await expect(second.getByLabel("Terminal output")).toContainText("hello-shared-terminal");
    await second.reload();
    await expect(second.getByLabel("Terminal output")).toContainText("hello-shared-terminal");
    await second.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Stop session", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start new session", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
