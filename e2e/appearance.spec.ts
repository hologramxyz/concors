import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("appearance follows the system and uses a shared neutral terminal/chat surface", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-appearance-"));
  try {
    await signedIn(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).first().waitFor();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await seedProject(page, "Appearance acceptance", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const terminal = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(terminal.locator("textarea")).toBeVisible();
    await expect(terminal).toHaveCSS("background-color", "rgb(27, 27, 27)");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return (
            styles.getPropertyValue("--terminal-background").trim() ===
            styles.getPropertyValue("--card").trim()
          );
        }),
      )
      .toBe(true);
    // Native theme changes should recolor an already mounted terminal without restarting it.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(terminal).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(terminal).toHaveCSS("background-color", "rgb(27, 27, 27)");
    await terminal.locator("textarea").focus();
    await page.keyboard.type("seq 1 100");
    await page.keyboard.press("Enter");
    const slider = terminal.locator(".scrollbar.vertical > .slider");
    await expect(slider).toBeVisible();
    const bottom = await slider.evaluate((el) => el.getAttribute("style"));
    await terminal.hover();
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => slider.evaluate((el) => el.getAttribute("style"))).not.toBe(bottom);
    await page.screenshot({ path: "test-results/neutral-terminal.png" });
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Theme", exact: true })).toHaveText("System");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitem", { name: "Light", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    // The stored explicit preference overrides a dark system preference.
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Theme", exact: true })).toHaveText("Light");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitem", { name: "System", exact: true }).click();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
