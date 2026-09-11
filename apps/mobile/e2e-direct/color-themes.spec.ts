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
  await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Desktop connection settings" }).click();
  await ui.getByRole("radio", { name: "Cobalt", exact: true }).locator("..").click();
  await ui.getByRole("button", { name: "Theme", exact: true }).click();
  await ui.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(ui.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
  await expect(page.getByTestId("workspace-safe-area")).toHaveCSS(
    "background-color",
    "rgb(11, 16, 32)",
  );
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
        dark: { sidebar: "#302219", accent: "#ffc099" },
      }),
    );
    await expect(ui.getByRole("radio", { name: "Mobile sunset", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await ui.getByRole("radio", { name: "Mobile sunset", exact: true }).locator("..").click();
    await expect(page.getByTestId("workspace-safe-area")).toHaveCSS(
      "background-color",
      "rgb(48, 34, 25)",
    );
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
    await expect(page.getByTestId("workspace-safe-area")).toHaveCSS(
      "background-color",
      "rgb(11, 11, 11)",
    );
    expect(errors).toEqual([]);
  } finally {
    await rm(file, { force: true });
  }
});
