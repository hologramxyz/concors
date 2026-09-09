import { expect, test, type Page } from "@playwright/test";
import { ids } from "../src/demo/fixtures";
const workspace = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  return ui;
}
test("chat-first shell reuses desktop approvals, streaming and bottom composer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ui = await enter(page);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Review the mobile client");
  await ui.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(ui.getByText(/This is a simulated response/)).toBeVisible();
  await expect(ui.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  const metrics = await ui.locator("[data-agent-composer]").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: window.innerHeight,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(metrics.top).toBeGreaterThan(metrics.height / 2);
  expect(metrics.bottom).toBeLessThan(metrics.height);
  expect(metrics.overflow).toBe(false);
  expect(errors).toEqual([]);
});
test("sidebar pushes the workspace and settings opens as a drawer over the same draft", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Keep this draft");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const sidebar = ui.getByRole("dialog", { name: "Workspace sidebar" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Projects", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Agents", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Servers", { exact: true })).toBeVisible();
  await expect
    .poll(() => ui.getByTestId("mobile-workspace").evaluate((el) => el.getBoundingClientRect().x))
    .toBeGreaterThan(250);
  await ui.getByRole("button", { name: "Return to workspace" }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue("Keep this draft");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await sidebar.getByRole("button", { name: "Settings" }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByLabel("Settings section").selectOption("appearance");
  await expect(settings.getByRole("button", { name: "Theme", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue("Keep this draft");
});
test("top select switches split panes and cold session links survive sign-in", async ({ page }) => {
  await page.goto(
    `/session?machineId=${ids.machine}&projectId=${ids.project}&sessionId=${ids.agent}`,
  );
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await ui
    .getByRole("combobox", { name: "Tabs and panes" })
    .selectOption(`${ids.tab}:${ids.terminalPane}`);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await ui.locator(".xterm-helper-textarea").pressSequentially("ls");
  await ui.locator(".xterm-helper-textarea").press("Enter");
  await expect(ui.locator(".xterm-accessibility-tree")).toContainText("ls");
  await ui.getByRole("combobox", { name: "Tabs and panes" }).selectOption(`${ids.tab}:${ids.pane}`);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  await ui.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore demo" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /auth|token|session/i.test(key)),
    ),
  ).toEqual([]);
});
