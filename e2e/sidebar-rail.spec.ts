import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";
import { seedProject } from "./support/projects.ts";
import type { Locator, Page } from "@playwright/test";

async function hoverControl(page: Page, control: Locator) {
  // Verify dismissal as well as hover, and avoid inheriting another tooltip's
  // pointer-transit grace area when Playwright jumps between distant controls.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await control.hover();
}

async function expectNoSidebarTooltips(page: Page, sidebar: Locator) {
  await page.keyboard.press("Escape");
  for (const control of await sidebar
    .locator("button:not([data-workspace-id]):not([data-agent-id])")
    .all()) {
    await control.hover();
    await control.focus();
    // Focus would open an enabled tooltip immediately, even when hover is delayed.
    await expect(control).not.toHaveAttribute("aria-describedby");
    await expect(control).not.toHaveAttribute("title");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
}

test("collapsed sidebar keeps workspace, machine, search and account navigation accessible", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-sidebar-rail-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/changing from (uncontrolled|controlled)/.test(message.text())) errors.push(message.text());
  });
  try {
    await signedIn(page);
    await managedHost(page);
    await page.goto("/");
    await seedProject(page, "Alpha workspace", directory);
    await mkdir(join(directory, "beta"));
    await seedProject(page, "Beta workspace", join(directory, "beta"));
    const rail = page.getByRole("navigation", { name: "Primary" });
    const shell = page.locator(".sidebar-shell");
    await expect(rail.getByText("No agents yet.", { exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
    await expectNoSidebarTooltips(page, rail);
    await rail.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(shell).toHaveCSS("width", "44px");
    await expect(rail).toBeVisible();
    await expect(shell).not.toHaveAttribute("inert");
    const expand = rail.getByRole("button", { name: "Expand sidebar", exact: true });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(rail.getByRole("button", { name: "Workspaces", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("region", { name: "Agents", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Previews", exact: true })).toHaveCount(0);
    for (const button of await rail.locator(".sidebar-rail-control").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBe(32);
      expect(bounds?.height).toBe(32);
    }
    for (const [name, label] of [
      ["Switch machine", "This computer"],
      ["Expand sidebar", "Expand sidebar"],
      ["Search", "Search"],
      ["Open workspace menu", "Workspaces"],
      ["Account: E2E User", "Account and settings"],
    ]) {
      await hoverControl(page, rail.getByRole("button", { name, exact: true }));
      await expect(page.getByRole("tooltip").filter({ hasText: label })).toBeVisible();
    }
    const alpha = rail.getByRole("button", { name: "Alpha workspace", exact: true });
    const beta = rail.getByRole("button", { name: "Beta workspace", exact: true });
    await expect(alpha.locator('[data-project-icon="folder"]')).toBeVisible();
    await expect(beta.locator('[data-project-icon="folder"]')).toBeVisible();
    await expect(beta).toHaveAttribute("aria-current", "page");
    await hoverControl(page, alpha);
    await expect(page.getByRole("tooltip")).toContainText("Alpha workspace");
    await alpha.click();
    await expect(page.getByRole("heading", { name: "Alpha workspace", exact: true })).toBeVisible();
    await expect(alpha).toHaveAttribute("aria-current", "page");
    await beta.focus();
    await expect(page.getByRole("tooltip")).toContainText("Beta workspace");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Beta workspace", exact: true })).toBeVisible();
    const search = rail.getByRole("button", { name: "Search", exact: true });
    await search.click();
    await expect(page.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
    await rail.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Open folder…", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
    await expect(rail).toHaveCount(0);
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(shell).toHaveCSS("width", "44px");
    await rail.getByRole("button", { name: "Switch machine", exact: true }).click();
    await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Settings" })
        .getByRole("button", { name: "Machines", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(rail).toHaveCount(0);
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(shell).toHaveCSS("width", "44px");
    await expect(beta).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Beta workspace", exact: true })).toBeVisible();
    await rail.getByRole("button", { name: "Switch machine", exact: true }).click();
    await page.getByRole("menuitem", { name: /Second machine Online/ }).click();
    await expect(rail.getByRole("img", { name: "Second machine: Connected" })).toBeVisible();
    await expect(alpha).toHaveCount(0);
    await expect(beta).toHaveCount(0);
    await expect(rail.getByText("—", { exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Open workspace menu" })).toBeVisible();
    await rail.getByRole("button", { name: "Switch machine", exact: true }).click();
    await page.getByRole("menuitem", { name: "This computer", exact: true }).click();
    await expect(beta).toHaveAttribute("aria-current", "page");
    await expect(shell).toHaveCSS("width", "44px");
    await page.screenshot({ path: test.info().outputPath("rail-light.png") });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 340 });
    await expect(shell).toHaveCSS("transition-duration", "0s");
    await expect(
      rail.getByRole("button", { name: "Switch machine", exact: true }),
    ).toBeInViewport();
    await expect(rail.getByRole("button", { name: /^Account:/ })).toBeInViewport();
    await beta.scrollIntoViewIfNeeded();
    await expect(beta).toBeInViewport();
    expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath("rail-narrow-dark.png") });
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(shell).toHaveCSS("width", "216px");
    await expect(rail.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeFocused();
    await expect(beta).toHaveText("Beta workspace");
    await expectNoSidebarTooltips(page, rail);
    await hoverControl(page, beta);
    await expect(page.getByRole("tooltip")).toContainText(join(directory, "beta"));
    await expect(rail.getByText("No agents yet.", { exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collapsed agents show provider icons and live status without losing chat drafts", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-rail-agents-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Rail agents", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const codex = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(codex).toBeEnabled();
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    const rail = page.getByRole("navigation", { name: "Primary" });
    const agents = rail.getByRole("region", { name: "Agents", exact: true });
    await expect(rail.getByRole("button", { name: "Agents", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Previews", exact: true })).toHaveCount(0);
    await expect(rail.getByText("—", { exact: true })).toHaveCount(0);
    const codexButton = agents.locator('button[data-agent-id]:has([data-provider="codex"])');
    await expect(codexButton.getByRole("img", { name: "Agent status: Ready" })).toBeVisible();
    await codex.fill("hello from the compact rail");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(codexButton.getByRole("img", { name: "Agent status: Done" })).toBeVisible();
    await expect(codexButton.locator(".bg-emerald-500")).toBeVisible();
    await codex.fill("Keep this draft");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(codex).toBeEnabled();
    await page.getByRole("button", { name: "Agent and model", exact: true }).click();
    await page.getByRole("button", { name: "Back to providers", exact: true }).click();
    await page.getByRole("option", { name: "Claude Code Use in this pane", exact: true }).click();
    await page.getByRole("option", { name: "Fixture claude model", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
    ).toBeEnabled();
    await expect(agents.locator("button[data-agent-id]")).toHaveCount(2);
    await expect(agents.locator('[data-provider="claude"]')).toBeVisible();
    await expect(agents.locator('[data-provider="codex"]')).toBeVisible();
    await hoverControl(page, codexButton);
    await expect(page.getByRole("tooltip")).toContainText("Rail agents");
    await codexButton.click();
    await expect(codex).toHaveValue("Keep this draft");
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText(
      "hello from the compact rail",
    );
    await page.screenshot({ path: test.info().outputPath("rail-providers-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: test.info().outputPath("rail-providers-dark.png") });
    await rail.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(codex).toHaveValue("Keep this draft");
    await expect(agents.getByRole("img", { name: "Agent status: Done" })).toBeVisible();
    await expectNoSidebarTooltips(page, rail);
    const expandedCodex = rail.locator('button[data-agent-id]:has([data-provider="codex"])');
    await expect(expandedCodex.locator('[data-provider="codex"]')).toBeVisible();
    await hoverControl(page, expandedCodex);
    await expect(page.getByRole("tooltip")).toContainText("Rail agents");
    await expect(page.getByRole("tooltip")).toContainText("Codex");
    await page.keyboard.press("Escape");
    await codex.fill("hold");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(expandedCodex.getByRole("img", { name: "Agent status: Working" })).toBeVisible();
    const badge = expandedCodex.locator("[data-agent-status-badge]");
    const paneBadge = page.getByTestId("pane-agent-loading");
    await expect(paneBadge).toBeVisible();
    for (const indicator of [badge, paneBadge]) {
      const bounds = await indicator.boundingBox();
      const parent = await indicator.locator("..").boundingBox();
      if (!bounds || !parent) throw new Error("Missing status badge bounds");
      expect(bounds.x + bounds.width / 2).toBeGreaterThan(parent.x + parent.width / 2);
      expect(bounds.y + bounds.height / 2).toBeGreaterThan(parent.y + parent.height / 2);
    }
    await rail.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(expandedCodex.getByRole("img", { name: "Agent status: Working" })).toBeVisible();
    await page.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(paneBadge).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collapsed tooltips follow menu colors in light, dark and custom palettes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const backgrounds: string[] = [];
  for (const palette of ["Concors", "Cobalt"]) {
    if (palette === "Cobalt") {
      await sidebar.getByRole("button", { name: /^Account:/ }).click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.getByRole("radio", { name: palette, exact: true }).locator("..").click();
      await expect(page.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
      await page.getByRole("button", { name: "Back to app", exact: true }).click();
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      await sidebar.getByRole("button", { name: "Switch machine", exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const colors = await menu.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, foreground: style.color };
      });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await hoverControl(page, sidebar.getByRole("button", { name: "Search", exact: true }));
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("Search");
      await expect(tooltip).toHaveCSS("background-color", colors.background);
      await expect(tooltip).toHaveCSS("color", colors.foreground);
      await expect(tooltip.locator("svg")).toHaveCSS("fill", colors.background);
      await expect(tooltip).toHaveCSS("opacity", "1");
      backgrounds.push(colors.background);
      await page.screenshot({
        path: test.info().outputPath(`tooltip-${palette.toLowerCase()}-${colorScheme}.png`),
      });
    }
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
  expect(backgrounds[2]).not.toBe(backgrounds[3]);
  expect(backgrounds[1]).not.toBe(backgrounds[3]);
});
