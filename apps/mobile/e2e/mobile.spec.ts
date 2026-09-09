import { expect, test, type Page } from "@playwright/test";
import { ids } from "../src/demo/fixtures";
const workspace = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
const activeChat = `${ids.tab}:${ids.pane}`;
const activeTerminal = `${ids.tab}:${ids.terminalPane}`;
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
test("shared composer preserves attachments and queued messages across pane changes", async ({
  page,
}) => {
  const ui = await enter(page);
  const composer = ui.getByRole("textbox", { name: "Message Codex" });
  const picker = ui.getByRole("combobox", { name: "Tabs and panes" });
  await composer.fill("A queued follow-up");
  await ui.getByLabel("Upload files").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Mobile parity"),
  });
  await expect(ui.getByLabel("Remove notes.txt")).toBeVisible();
  await picker.selectOption(activeTerminal);
  await picker.selectOption(activeChat);
  await expect(composer).toHaveValue("A queued follow-up");
  await expect(ui.getByLabel("Remove notes.txt")).toBeVisible();
  await ui.getByRole("button", { name: "Queue message", exact: true }).click();
  await expect(ui.locator("[data-composer-queue]")).toContainText("A queued follow-up");
  await picker.selectOption(activeTerminal);
  await picker.selectOption(activeChat);
  await expect(ui.locator("[data-composer-queue]")).toContainText("A queued follow-up");
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(ui.getByText(/This is a simulated response/)).toBeVisible();
  await expect(ui.locator("[data-composer-queue]")).toHaveCount(0);
});
test("model, effort, permissions, plan and speed use the desktop controls", async ({ page }) => {
  const ui = await enter(page);
  for (const [control, option, value] of [
    ["Agent and model", "Codex", "demo-codex"],
    ["Thinking effort", "High", "high"],
    ["Permission mode", "Auto-review", "auto-review"],
    ["Speed", "Fast", "fast"],
  ] as const) {
    const button = ui.getByRole("button", { name: control, exact: true });
    await button.click();
    await ui.getByRole("option", { name: new RegExp(`^${option}`) }).click();
    await expect(button).toHaveAttribute("data-value", value);
  }
  await ui.getByRole("button", { name: "Plan mode", exact: true }).click();
  await expect(ui.getByRole("button", { name: "Plan mode", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("ask me a question");
  await ui.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(ui.getByText("Which platform should I verify?")).toBeVisible();
});
test("composer stays visible with keyboard-sized viewport and return inserts a newline", async ({
  page,
}) => {
  const ui = await enter(page);
  await page.setViewportSize({ width: 390, height: 420 });
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  await input.fill("First line");
  await input.press("Enter");
  await expect(input).toHaveValue("First line\n");
  await expect(input).toBeFocused();
  const layout = await ui.locator("[data-chat-footer]").evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    height: window.innerHeight,
    top: element.getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  expect(layout.top).toBeGreaterThan(100);
  expect(layout.overflow).toBe(false);
});
test("touch swipes reveal and dismiss the push sidebar", async ({ page }) => {
  const ui = await enter(page);
  const client = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from, y: 240 }],
    });
    for (let step = 1; step <= 8; step++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from + ((to - from) * step) / 8, y: 240 }],
      });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(4, 285);
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await swipe(285, 25);
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
});
test("tab and pane changes use the authoritative workspace operations", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "New tab", exact: true }).click();
  await ui.getByRole("menuitem", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await ui.getByRole("menuitem", { name: "Rename tab" }).click();
  await ui.getByRole("textbox", { name: "Tab name" }).fill("Second conversation");
  await ui.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Tabs and panes" })).toContainText(
    "Second conversation",
  );
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await ui.getByRole("menuitem", { name: "Split horizontally" }).click();
  await expect(ui.getByRole("combobox", { name: "Tabs and panes" }).locator("option")).toHaveCount(
    4,
  );
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await ui.getByRole("menuitem", { name: "Close pane…", exact: true }).click();
  await ui.getByRole("button", { name: "Close pane", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Tabs and panes" }).locator("option")).toHaveCount(
    3,
  );
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
test("desktop tool cards, diffs, MCP results, subagents and markdown fit a phone", async ({
  page,
}) => {
  const ui = await enter(page);
  const tools = ui.getByRole("article", { name: "Tool call", exact: true });
  await expect(tools).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await tools.nth(i).getByRole("button").first().click();
    await expect(tools.nth(i).getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
    await expect(tools.nth(i).getByRole("button", { name: "Copy tool output" })).toBeVisible();
  }
  await expect(ui.getByRole("button", { name: "Copy diff" })).toBeAttached();
  await expect(ui.getByRole("article", { name: "Sub-agent activity" })).toBeAttached();
  await expect(ui.getByRole("article", { name: "Thinking summary" })).toBeAttached();
  await expect(ui.locator("pre").filter({ hasText: "const workspace" })).toBeAttached();
  expect(
    await ui.locator("body").evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
});
test("project creation and shared settings remain available from the sidebar", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Add project", exact: true }).click();
  await ui.getByRole("combobox", { name: "Project source" }).selectOption("create");
  await ui.getByRole("textbox", { name: "Project name" }).fill("Phone project");
  await ui
    .getByRole("dialog", { name: "Add project", exact: true })
    .getByRole("button", { name: "Add project", exact: true })
    .click();
  await expect(ui.getByRole("dialog", { name: "Add project" })).toHaveCount(0);
  await expect(ui.getByRole("heading", { name: "Phone project", exact: true })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  const section = ui.getByLabel("Settings section");
  await section.selectOption("notifications");
  await expect(ui.getByRole("checkbox", { name: "Push notifications" })).toBeDisabled();
  await section.selectOption("billing");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("Billing");
  await section.selectOption("ssh-keys");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("SSH");
  await section.selectOption("advanced");
  await expect(ui.getByText("In-memory demo", { exact: true })).toBeVisible();
});
test("foreground reconnect preserves an unsent draft without replaying it", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Do not lose this draft");
  const visibility = async (value: string) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, value);
  await visibility("hidden");
  await expect(ui.getByText("Reconnecting… Saved workspace is read-only.")).toBeVisible();
  await visibility("visible");
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
    "Do not lose this draft",
  );
  await expect(ui.getByRole("log", { name: "Chat timeline" })).not.toContainText(
    "Do not lose this draft",
  );
});
