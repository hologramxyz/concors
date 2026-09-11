import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

test("corner styles update the live workspace and portaled controls, sync, and persist", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-corners-"));
  const second = await context.newPage();
  const errors: string[] = [];
  for (const client of [page, second])
    client.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Corner styles", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await page
      .getByRole("textbox", { name: "Message Codex" })
      .fill("Keep this draft while changing corners");
    const model = page.getByRole("button", { name: "Agent and model", exact: true });
    await expect(model).toBeEnabled();
    await model.click();
    const modelOptions = page.getByRole("listbox", { name: "Agent and model" });
    await expect(modelOptions).toBeVisible();

    await signedIn(second);
    await second.goto("/");
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await second
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Appearance" })
      .click();
    await expect(
      second.getByRole("radio", { name: "Slightly rounded", exact: true }),
    ).toBeChecked();

    const surfaces: Locator[] = [
      page.locator(".workspace-surface"),
      page.getByRole("textbox", { name: "Message Codex" }).locator(".."),
      page.locator("[data-tab-id]").first(),
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "Corner styles", exact: true })
        .locator(".."),
      model,
      modelOptions.locator(".."),
      modelOptions.getByRole("option").first(),
      page.getByRole("button", { name: "Pane actions", exact: true }),
      second.getByRole("button", { name: "Theme", exact: true }),
      second.getByRole("button", { name: "Appearance", exact: true }),
    ];
    const radius = (surface: Locator) =>
      surface.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    const subtle = await Promise.all(surfaces.map(radius));
    for (const value of subtle) expect(value).toBeGreaterThan(0);

    // Native radio keys also switch styles without requiring a pointer.
    await second.getByRole("radio", { name: "Slightly rounded", exact: true }).focus();
    await second.keyboard.press("ArrowLeft");
    await expect(second.getByRole("radio", { name: "Square", exact: true })).toBeChecked();
    for (const surface of surfaces)
      await expect(surface).toHaveCSS("border-top-left-radius", "0px");
    await second.screenshot({ path: "test-results/settings-square.png" });
    await page.screenshot({ path: "test-results/workspace-square.png" });

    await second.keyboard.press("ArrowRight");
    await expect(
      second.getByRole("radio", { name: "Slightly rounded", exact: true }),
    ).toBeChecked();
    for (const [index, surface] of surfaces.entries())
      await expect.poll(() => radius(surface)).toBe(subtle[index]);
    await second.keyboard.press("ArrowRight");
    await expect(second.getByRole("radio", { name: "Rounded", exact: true })).toBeChecked();
    for (const [index, surface] of surfaces.entries())
      await expect.poll(() => radius(surface)).toBeGreaterThan(subtle[index] ?? 0);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
      "Keep this draft while changing corners",
    );
    await second.emulateMedia({ colorScheme: "dark" });
    await expect(second.locator("html")).toHaveClass(/dark/);
    await second.screenshot({ path: "test-results/settings-rounded-dark.png" });
    await page.screenshot({ path: "test-results/workspace-rounded.png" });

    await second.reload();
    await expect(second.locator("html")).toHaveAttribute("data-corner-style", "rounded");
    // The persisted theme is applied before session restoration enables app shortcuts.
    await expect(second.getByRole("button", { name: /^Account:/ })).toBeVisible();
    await second.keyboard.press("Control+Shift+Comma");
    await second.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(second.getByRole("radio", { name: "Rounded", exact: true })).toBeChecked();
    await second.getByRole("radio", { name: "Rounded", exact: true }).focus();
    await second.keyboard.press("ArrowRight"); // Wrap to square.
    await expect(second.getByRole("radio", { name: "Square", exact: true })).toBeChecked();
    await page.reload();
    await expect(page.locator(".workspace-surface")).toHaveCSS("border-radius", "0px");
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open folder…", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS("border-radius", "0px");
    await expect(page.getByLabel("Folder path", { exact: true })).toHaveCSS("border-radius", "0px");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  } finally {
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});
