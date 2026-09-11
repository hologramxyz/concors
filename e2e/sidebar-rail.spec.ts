import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";
import { seedProject } from "./support/projects.ts";
import type { Locator, Page } from "@playwright/test";

async function hoverControl(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.boundingBox();
  expect(bounds).not.toBeNull();
  // Trace a real pointer path instead of teleporting into a neighboring
  // tooltip's hoverable-content grace area.
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2, {
    steps: 10,
  });
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
    await rail.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(shell).toHaveCSS("width", "44px");
    await expect(rail).toBeVisible();
    await expect(shell).not.toHaveAttribute("inert");
    const expand = rail.getByRole("button", { name: "Expand sidebar", exact: true });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(rail.getByRole("button", { name: "Workspaces", exact: true })).toHaveCount(0);
    for (const button of await rail.locator(".sidebar-rail-control").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBe(32);
      expect(bounds?.height).toBe(32);
    }
    for (const [name, label] of [
      ["Switch machine", "This computer"],
      ["Expand sidebar", "Expand sidebar"],
      ["Open workspace menu", "Workspaces"],
      ["Agents", "Agents"],
      ["Servers", "Servers"],
      ["Account: E2E User", "Account and settings"],
    ]) {
      await hoverControl(page, rail.getByRole("button", { name, exact: true }));
      await expect(page.getByRole("tooltip").filter({ hasText: label })).toBeVisible();
    }
    const alpha = rail.getByRole("button", { name: "Alpha workspace", exact: true });
    const beta = rail.getByRole("button", { name: "Beta workspace", exact: true });
    await expect(alpha).toHaveText("A");
    await expect(beta).toHaveText("B");
    await expect(beta).toHaveAttribute("aria-current", "page");
    await hoverControl(page, alpha);
    await expect(page.getByRole("tooltip")).toContainText("Alpha workspace");
    await alpha.click();
    await expect(page.getByRole("heading", { name: "Alpha workspace", exact: true })).toBeVisible();
    await expect(alpha).toHaveAttribute("aria-current", "page");
    await beta.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Beta workspace", exact: true })).toBeVisible();
    const search = rail.getByRole("button", { name: "Search", exact: true });
    await search.click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
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
    await page.getByRole("menuitem", { name: /Second machine Online/ }).click();
    await expect(rail.getByRole("img", { name: "Second machine: Connected" })).toBeVisible();
    await expect(alpha).toHaveCount(0);
    await expect(beta).toHaveCount(0);
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
    await rail.getByRole("button", { name: "Servers", exact: true }).scrollIntoViewIfNeeded();
    await expect(rail.getByRole("button", { name: "Servers", exact: true })).toBeInViewport();
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
