import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("projects open a terminal immediately and new tabs start the chosen profile", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-profile-controls-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Profile controls", directory);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start terminal", exact: true })).toHaveCount(0);
    await expect(page.getByText("A terminal for this project")).toHaveCount(0);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    for (const name of ["Terminal", "Agent", "Codex", "Claude Code", "OpenCode"]) {
      await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Project tabs").locator("[data-tab-id]")).toHaveCount(1);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Configure terminal profile…" }).click();
    await page.getByLabel("Tab name", { exact: true }).fill("Development");
    await page.getByLabel("Terminal profile", { exact: true }).selectOption("shell");
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Development", exact: true })).toBeVisible();
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start terminal", exact: true })).toHaveCount(0);
    const tab = page.getByLabel("Project tabs").locator("[data-tab-id]").last();
    const bounds = await tab.boundingBox();
    expect(bounds?.height).toBeLessThanOrEqual(25);
    await page.getByLabel("Terminal output").filter({ visible: true }).click();
    await page.keyboard.type("printf 'configured-%s\\n' session");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "configured-session",
    );
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const before = await page.getByLabel("Terminal output").filter({ visible: true }).boundingBox();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sidebar).toBeHidden();
    await expect(page.locator(".sidebar-shell")).toHaveAttribute("inert", "");
    await expect(page.locator(".sidebar-shell")).toHaveCSS("transition-property", "width");
    await expect(page.locator(".sidebar-shell")).toHaveCSS("width", "0px");
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Profile controls", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.getByLabel("Terminal output").filter({ visible: true }).boundingBox())
            ?.width ?? 0,
      )
      .toBeGreaterThan(before?.width ?? 0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "configured-session",
    );
    await page.screenshot({ path: "test-results/sidebar-collapsed.png" });
    await page.keyboard.press("Enter");
    await expect(sidebar).toBeVisible();
    await expect(page.locator(".sidebar-shell")).toHaveCSS("width", "216px");
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Development", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.screenshot({ path: "test-results/project-controls.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".sidebar-shell")).toHaveCSS("transition-duration", "0s");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.locator(".sidebar-shell")).toHaveCSS("width", "0px");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.locator(".sidebar-shell")).toHaveCSS("width", "216px");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
