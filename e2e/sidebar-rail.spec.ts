import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";
import { seedProject } from "./support/projects.ts";
import type { Locator, Page } from "@playwright/test";
import { chooseProvider } from "./support/agents.ts";

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
    // A workspace's tab list stays in place while closed, hidden once it has eased shut.
    if (!(await control.isVisible())) continue;
    await control.hover();
    await control.focus();
    // Focus would open an enabled tooltip immediately, even when hover is delayed.
    await expect(control).not.toHaveAttribute("aria-describedby");
    await expect(control).not.toHaveAttribute("title");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
}

test("a collapsed sidebar hides entirely and its toggle brings it back", async ({ page }) => {
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
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const shell = page.locator(".sidebar-shell");
    await expect(sidebar.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
    await expectNoSidebarTooltips(page, sidebar);
    const tabs = await page.getByLabel("Project tabs", { exact: true }).boundingBox();
    await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(shell).toHaveCSS("width", "0px");
    await expect(shell).toHaveAttribute("inert", "");
    await expect(sidebar).toBeHidden();
    // No rail: the content takes the width, led by the toggle that brings the sidebar back and
    // search beside it.
    const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Account:/ })).toHaveCount(0);
    const surface = await page.locator(".workspace-surface").boundingBox();
    expect(surface?.x).toBeLessThan(10);
    const collapsedTabs = await page.getByLabel("Project tabs", { exact: true }).boundingBox();
    expect(collapsedTabs?.x).toBeLessThan(tabs?.x ?? 0);
    await hoverControl(page, expand);
    await expect(page.getByRole("tooltip").filter({ hasText: "Expand sidebar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beta workspace", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("collapsed-light.png") });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 340 });
    await expect(shell).toHaveCSS("transition-duration", "0s");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath("collapsed-narrow-dark.png") });
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(shell).toHaveCSS("width", "216px");
    await expect(shell).not.toHaveAttribute("inert");
    await expect(
      sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
    const beta = sidebar.getByRole("button", { name: "Beta workspace", exact: true });
    await expect(beta).toHaveAttribute("aria-current", "page");
    await expectNoSidebarTooltips(page, sidebar);
    await hoverControl(page, beta);
    await expect(page.getByRole("tooltip")).toContainText(join(directory, "beta"));
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chats keep their drafts and live status while the sidebar is collapsed", async ({ page }) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-rail-agents-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Rail agents", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const codex = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(codex).toBeEnabled();
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    const rail = page.getByRole("navigation", { name: "Primary" });
    // Collapsed, the sidebar is hidden; the tab bar still shows each chat.
    await expect(rail).toBeHidden();
    const tabs = page.getByLabel("Project tabs", { exact: true });
    const codexTab = tabs.locator("[data-tab-id]").nth(1).locator("button").first();
    await codex.fill("hello from the compact rail");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // The open chat has seen its finished turn, so its tab carries no badge.
    await expect(page.getByText(/^Worked for /)).toHaveCount(1);
    await expect(codexTab.locator('[data-provider="codex"]')).toBeVisible();
    await expect(codexTab.locator("[data-agent-status-badge]")).toHaveCount(0);
    await codex.fill("Keep this draft");
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(codex).toBeEnabled();
    await page.getByRole("button", { name: "Agent and model", exact: true }).click();
    await page.getByRole("button", { name: "Back to providers", exact: true }).click();
    await page
      .getByRole("option", {
        name: "Claude Code Starts a new conversation in this pane",
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: "Fixture claude model", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
    ).toBeEnabled();
    await expect(tabs.locator('[data-provider="claude"]')).toBeVisible();
    await codexTab.click();
    await expect(codex).toHaveValue("Keep this draft");
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText(
      "hello from the compact rail",
    );
    await page.screenshot({ path: test.info().outputPath("rail-providers-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: test.info().outputPath("rail-providers-dark.png") });
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(codex).toHaveValue("Keep this draft");
    // Expanded, the chats sit under their workspace instead.
    await expect(
      rail
        .getByRole("list", { name: "Rail agents tabs", exact: true })
        .getByRole("img", { name: "Agent status: Ready" }),
    ).toHaveCount(2);
    await expectNoSidebarTooltips(page, rail);
    const expandedCodex = rail.locator('button[data-agent-id]:has([data-provider="codex"])');
    await expect(expandedCodex.locator('[data-provider="codex"]')).toBeVisible();
    await hoverControl(page, expandedCodex);
    await expect(page.getByRole("tooltip")).toContainText("Codex");
    await page.keyboard.press("Escape");
    await codex.fill("hold");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // Expanded, a working chat shows a quiet dot; the pane keeps its corner badge.
    await expect(expandedCodex.getByRole("img", { name: "Agent status: Working" })).toHaveAttribute(
      "data-row-state",
      "working",
    );
    const paneBadge = page.getByTestId("pane-agent-loading");
    await expect(paneBadge).toBeVisible();
    for (const indicator of [paneBadge]) {
      const bounds = await indicator.boundingBox();
      const parent = await indicator.locator("..").boundingBox();
      if (!bounds || !parent) throw new Error("Missing status badge bounds");
      expect(bounds.x + bounds.width / 2).toBeGreaterThan(parent.x + parent.width / 2);
      expect(bounds.y + bounds.height / 2).toBeGreaterThan(parent.y + parent.height / 2);
    }
    await rail.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    // Collapsed, the working chat is still marked on its tab.
    await expect(codexTab.locator("[data-agent-status-badge]")).toBeVisible();
    await page.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(paneBadge).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the collapsed sidebar's toggle tooltip follows menu colors in light, dark and custom palettes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Primary" });
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
      await sidebar.getByRole("button", { name: /^Account:/ }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const colors = await menu.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, foreground: style.color };
      });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
      await hoverControl(page, expand);
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("Expand sidebar");
      await expect(tooltip).toHaveCSS("background-color", colors.background);
      await expect(tooltip).toHaveCSS("color", colors.foreground);
      await expect(tooltip.locator("svg")).toHaveCSS("fill", colors.background);
      await expect(tooltip).toHaveCSS("opacity", "1");
      backgrounds.push(colors.background);
      await page.screenshot({
        path: test.info().outputPath(`tooltip-${palette.toLowerCase()}-${colorScheme}.png`),
      });
      await expand.click();
    }
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
  expect(backgrounds[2]).not.toBe(backgrounds[3]);
  expect(backgrounds[1]).not.toBe(backgrounds[3]);
});
