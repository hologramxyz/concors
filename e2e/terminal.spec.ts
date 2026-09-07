import { test, expect } from "@playwright/test";

import { signedIn } from "./signed-in.ts";

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
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");

    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Terminal acceptance");
    await page.getByLabel("Folder on this machine").fill(process.cwd());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("button", { name: "Start terminal", exact: true }).click();
    await expect(page.getByLabel("Terminal output")).toBeVisible();
    await expect(page.getByRole("button", { name: "Take control", exact: true })).toHaveCount(0);

    await expect
      .poll(() =>
        page.getByLabel("Terminal output").evaluate((element) => ({
          horizontal: element.scrollWidth > element.clientWidth,
          vertical: element.scrollHeight > element.clientHeight,
        })),
      )
      .toEqual({ horizontal: false, vertical: false });
    await page.keyboard.type("printf 'hello-%s\\n' shared-terminal");
    await page.keyboard.press("Enter");
    await second.goto("http://localhost:1420");
    await expect(second.getByLabel("Terminal output")).toContainText("hello-shared-terminal");
    await second.reload();
    await expect(second.getByLabel("Terminal output")).toContainText("hello-shared-terminal");
    await second.getByLabel("Terminal output").click();
    await second.keyboard.type("printf 'second-%s\\n' device");
    await second.keyboard.press("Enter");
    await expect(page.getByLabel("Terminal output")).toContainText("second-device");
    await second.keyboard.type("exit");
    await second.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Start new session", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
