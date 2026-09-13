import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

test("mobile applies built-in and local-file palettes through the native preference bridge", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concourse workspace"]');
  const expectCanvas = async (color: string) => {
    await expect(page.getByTestId("workspace-safe-area")).toHaveCSS("background-color", color);
    await expect(page.locator('iframe[title="Concourse workspace"]')).toHaveCSS(
      "background-color",
      color,
    );
    await expect(ui.getByTestId("mobile-workspace")).toHaveCSS("background-color", color);
  };
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
  await ui
    .getByRole("dialog", { name: "Account", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await ui.getByRole("radio", { name: "Cobalt", exact: true }).locator("..").click();
  await ui.getByRole("button", { name: "Theme", exact: true }).click();
  await ui.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(ui.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
  await expectCanvas("rgb(16, 22, 37)");
  await expect(ui.getByLabel("Theme directory")).toBeVisible();
  const directory = await ui.getByLabel("Theme directory").innerText();
  await mkdir(directory, { recursive: true });
  const id = `mobile-${crypto.randomUUID()}`,
    file = join(directory, `${id}.json`);
  try {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        id,
        name: "Mobile sunset",
        extends: "sand",
        dark: { background: "#35271d", sidebar: "#302219", accent: "#ffc099" },
      }),
    );
    await expect(ui.getByRole("radio", { name: "Mobile sunset", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await ui.getByRole("radio", { name: "Mobile sunset", exact: true }).locator("..").click();
    await expectCanvas("rgb(53, 39, 29)");
    await expect(ui.locator("html")).toHaveAttribute("data-color-theme", id);
    const width = await ui
      .locator("body")
      .evaluate((body) => ({ scroll: body.scrollWidth, width: body.clientWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.width);
    await page.screenshot({ path: test.info().outputPath("mobile-color-themes.png") });
    await rm(file);
    await expect(ui.locator("html")).toHaveAttribute("data-color-theme", "concors", {
      timeout: 10_000,
    });
    await expectCanvas("rgb(20, 20, 20)");
    expect(errors).toEqual([]);
  } finally {
    await rm(file, { force: true });
  }
});
