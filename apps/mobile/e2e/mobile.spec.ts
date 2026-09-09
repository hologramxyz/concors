import { expect, test, type Page, type FrameLocator } from "@playwright/test";
import { ids } from "../src/demo/fixtures";
const workspace = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
const activeChat = `${ids.tab}:${ids.pane}`;
const activeTerminal = `${ids.tab}:${ids.terminalPane}`;
async function choose(ui: FrameLocator, label: string, value: string) {
  await ui.getByRole("combobox", { name: label, exact: true }).click();
  await ui.locator(`[role="option"][data-value="${value}"]`).click();
}
async function paneCount(ui: FrameLocator, count: number) {
  const picker = ui.getByRole("combobox", { name: "Tabs and panes" });
  await picker.click();
  await expect(ui.getByRole("option")).toHaveCount(count);
  await ui.getByRole("option").first().press("Escape");
}
async function openSettings(ui: FrameLocator) {
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui.getByRole("menuitem", { name: "Settings", exact: true }).click();
}
test("offline renderer supplies secure request IDs without the browser UUID helper", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.parent !== window)
      Object.defineProperty(Crypto.prototype, "randomUUID", {
        configurable: true,
        value: undefined,
      });
  });
  const ui = await enter(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await ui.getByRole("button", { name: "New tab", exact: true }).click();
  await ui.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await paneCount(ui, 3);
});
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
  await composer.fill("A queued follow-up");
  await ui.getByLabel("Upload files").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Mobile parity"),
  });
  await expect(ui.getByLabel("Remove notes.txt")).toBeVisible();
  await choose(ui, "Tabs and panes", activeTerminal);
  await choose(ui, "Tabs and panes", activeChat);
  await expect(composer).toHaveValue("A queued follow-up");
  await expect(ui.getByLabel("Remove notes.txt")).toBeVisible();
  await ui.getByRole("button", { name: "Queue message", exact: true }).click();
  await expect(ui.locator("[data-composer-queue]")).toContainText("A queued follow-up");
  await choose(ui, "Tabs and panes", activeTerminal);
  await choose(ui, "Tabs and panes", activeChat);
  await expect(ui.locator("[data-composer-queue]")).toContainText("A queued follow-up");
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(ui.getByText(/This is a simulated response/)).toBeVisible();
  await expect(ui.locator("[data-composer-queue]")).toHaveCount(0);
});
test("model, effort, permissions, plan and speed use the desktop controls", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).click();
  for (const [control, option, value] of [
    ["Agent and model", "Codex", "demo-codex"],
    ["Thinking effort", "High", "high"],
    ["Permission mode", "Auto-review", "auto-review"],
    ["Speed", "Fast", "fast"],
  ] as const) {
    if (control === "Speed")
      await ui.getByRole("button", { name: "More composer options" }).click();
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
  await ui.getByRole("button", { name: "More composer options" }).click();
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(ui.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
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
  await ui.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await ui.getByRole("menuitem", { name: "Rename tab" }).click();
  await ui.getByRole("textbox", { name: "Tab name" }).fill("Second conversation");
  await ui.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Tabs and panes" })).toContainText(
    "Second conversation",
  );
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await expect(
    ui.getByRole("menuitem", { name: /Split|New pane|Arrange panes|Move tab/ }),
  ).toHaveCount(0);
  await ui.getByRole("menuitem", { name: "Close pane…", exact: true }).click();
  await ui.getByRole("button", { name: "Close pane", exact: true }).click();
  await paneCount(ui, 2);
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
  await openSettings(ui);
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await choose(ui, "Settings section", "appearance");
  await expect(settings.getByRole("button", { name: "Theme", exact: true })).toBeVisible();
  await settings.getByText("Square", { exact: true }).click();
  await expect(settings.getByRole("radio", { name: "Square", exact: true })).toBeChecked();
  await expect(settings).toHaveCSS("border-top-left-radius", "0px");
  await settings.getByRole("button", { name: "Theme", exact: true }).click();
  await ui.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(ui.locator("html")).toHaveClass("dark");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(ui.locator("form:has([data-agent-composer])")).toHaveCSS(
    "border-top-left-radius",
    "0px",
  );
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue("Keep this draft");
});
test("top select switches split panes and cold session links survive sign-in", async ({ page }) => {
  await page.goto(
    `/session?machineId=${ids.machine}&projectId=${ids.project}&sessionId=${ids.agent}`,
  );
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await choose(ui, "Tabs and panes", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await ui.locator(".xterm-helper-textarea").pressSequentially("ls");
  await ui.locator(".xterm-helper-textarea").press("Enter");
  await expect(ui.locator(".xterm-accessibility-tree")).toContainText("ls");
  await choose(ui, "Tabs and panes", activeChat);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
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
  await openSettings(ui);
  await choose(ui, "Settings section", "notifications");
  await expect(ui.getByRole("checkbox", { name: "Push notifications" })).toBeDisabled();
  await choose(ui, "Settings section", "billing");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("Billing");
  await choose(ui, "Settings section", "ssh-keys");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("SSH");
  await choose(ui, "Settings section", "advanced");
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

test("compact toolbar keeps icon controls and send on one row at phone widths", async ({
  page,
}) => {
  const ui = await enter(page);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 664 });
    await ui.getByRole("textbox", { name: "Message Codex" }).click();
    const metrics = await ui.locator(".mobile-composer-toolbar").evaluate((toolbar) => {
      const bounds = toolbar.getBoundingClientRect();
      return [...toolbar.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          top: rect.top + rect.height / 2,
          left: rect.left,
          right: rect.right,
          start: bounds.left,
          end: bounds.right,
        };
      });
    });
    expect(new Set(metrics.map(({ top }) => Math.round(top))).size).toBe(1);
    for (const rect of metrics) {
      expect(rect.left).toBeGreaterThanOrEqual(rect.start);
      expect(rect.right).toBeLessThanOrEqual(rect.end);
    }
    for (const label of ["Agent and model", "Thinking effort", "Permission mode"]) {
      await expect(ui.getByRole("button", { name: label, exact: true })).toHaveText("");
    }
    const header = ui.locator(".mobile-header");
    await expect(header).not.toContainText("Concors");
    const chevronInside = await ui
      .getByRole("combobox", { name: "Tabs and panes" })
      .evaluate((picker) => {
        const bounds = picker.getBoundingClientRect();
        const chevron = picker.querySelector(".mobile-select-chevron")?.getBoundingClientRect();
        if (!chevron) return false;
        return (
          chevron.right <= bounds.right &&
          chevron.left >= bounds.left &&
          chevron.top >= bounds.top &&
          chevron.bottom <= bounds.bottom
        );
      });
    expect(chevronInside).toBe(true);
  }
});

test("search and project sheets animate above the open sidebar and restore focus", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const shell = ui.locator(".mobile-shell");
  await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
  const search = ui.getByRole("dialog", { name: "Search workspace", exact: true });
  await expect(search).toHaveAttribute("data-mobile-drawer", "true");
  await expect(search).toHaveCSS("animation-name", "mobile-drawer-in");
  await expect(search).toHaveCSS("border-bottom-left-radius", "0px");
  await expect(search.getByRole("option", { name: /New pane|Split/ })).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  await search.getByRole("combobox").fill("no-such-project");
  await expect(search.getByText("No results.")).toBeVisible();
  await search.getByRole("button", { name: "Close", exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  await expect(ui.getByRole("button", { name: "Search workspace", exact: true })).toBeFocused();
  await ui.getByRole("button", { name: "Add project", exact: true }).click();
  const project = ui.getByRole("dialog", { name: "Add project", exact: true });
  await expect(project).toHaveAttribute("data-mobile-drawer", "true");
  await project.getByRole("textbox", { name: "Project name" }).fill("Discard this draft");
  await project.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(project).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ui.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(project).toHaveCSS("animation-name", "none");
  await expect(project.getByRole("textbox", { name: "Project name" })).toHaveValue("");
});

test("composer expands on focus, preserves portaled controls, and collapses after keyboard dismissal", async ({
  page,
}) => {
  const ui = await enter(page);
  const form = ui.locator(".mobile-composer");
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  const primary = form.locator(".mobile-composer-primary button");
  await expect(form).toHaveAttribute("data-expanded", "false");
  await expect(form.getByRole("button")).toHaveCount(2);
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("aria-label", "Interrupt agent");
  const collapsedBounds = await form.boundingBox();
  if (!collapsedBounds) throw new Error("Collapsed composer is not visible");
  expect(collapsedBounds.height).toBeLessThanOrEqual(60);
  await input.click();
  await expect(form).toHaveAttribute("data-expanded", "true");
  for (const name of [
    "Agent and model",
    "Thinking effort",
    "Permission mode",
    "Context window",
    "Start dictation",
  ]) {
    await expect(form.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await form.getByRole("button", { name: "Context window", exact: true }).click();
  await expect(ui.getByText(/cumulative tokens/)).toBeVisible();
  await expect(form).toHaveAttribute("data-expanded", "true");
  await ui.getByText(/cumulative tokens/).press("Escape");
  await input.fill("Keep this multiline\ndraft");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("aria-label", "Queue message");
  await ui.getByRole("combobox", { name: "Tabs and panes" }).tap();
  await expect(form).toHaveAttribute("data-expanded", "false");
  await ui.getByRole("combobox", { name: "Tabs and panes" }).tap();
  await input.click();
  await page.setViewportSize({ width: 393, height: 420 });
  await expect(form).toHaveAttribute("data-expanded", "true");
  // A toolbar button can keep focus after the OS dismisses the keyboard.
  await form.getByRole("button", { name: "Attach files" }).focus();
  await page.setViewportSize({ width: 393, height: 851 });
  await expect(form).toHaveAttribute("data-expanded", "false");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue("Keep this multiline\ndraft");
  await input.click();
  await page.setViewportSize({ width: 393, height: 420 });
  await form.getByRole("button", { name: "Context window", exact: true }).click();
  await page.setViewportSize({ width: 393, height: 851 });
  await expect(form).toHaveAttribute("data-expanded", "true");
  await expect(ui.getByText(/cumulative tokens/)).toBeVisible();
  await ui.getByText(/cumulative tokens/).press("Escape");
  await input.fill("");
  await primary.click();
  await expect(primary).toHaveAttribute("aria-label", "Send message");
  const centered = await primary.evaluate((button) => {
    const b = button.getBoundingClientRect(),
      s = button.querySelector("svg")?.getBoundingClientRect();
    if (!s) return false;
    return (
      Math.abs(b.x + b.width / 2 - s.x - s.width / 2) < 1 &&
      Math.abs(b.y + b.height / 2 - s.y - s.height / 2) < 1
    );
  });
  expect(centered).toBe(true);
});

test("tab picker toggles on repeated taps and groups panes beneath their tabs", async ({
  page,
}) => {
  const ui = await enter(page);
  const picker = ui.getByRole("combobox", { name: "Tabs and panes" });
  const list = ui.getByRole("listbox", { name: "Tabs and panes" });
  for (let i = 0; i < 3; i++) {
    await picker.tap();
    await expect(list).toBeVisible();
    await expect(list.getByRole("group")).toHaveCount(1);
    await expect(list.getByRole("option")).toHaveCount(2);
    await picker.tap();
    await expect(list).toHaveCount(0);
    await expect(picker).toHaveAttribute("aria-expanded", "false");
  }
  await picker.press("ArrowDown");
  await expect(list.getByRole("option").first()).toBeFocused();
  await list.getByRole("option").first().press("End");
  await expect(list.getByRole("option").last()).toBeFocused();
  await list.getByRole("option").last().press("Enter");
  await expect(picker).toHaveAttribute("data-value", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await choose(ui, "Tabs and panes", activeChat);
  await ui.getByRole("button", { name: "New tab", exact: true }).click();
  let drawer = ui.getByRole("dialog", { name: "New tab", exact: true });
  for (const name of ["Codex", "Claude Code", "OpenCode"]) {
    await expect(
      drawer.getByRole("button", { name, exact: true }).locator(".mobile-session-icon svg"),
    ).toHaveCount(1);
  }
  await drawer.getByRole("button", { name: "Add pane to this tab", exact: true }).click();
  drawer = ui.getByRole("dialog", { name: "Add pane", exact: true });
  await drawer.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(picker).toContainText("Mobile launch");
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  const addedPane = await picker.getAttribute("data-value");
  if (!addedPane) throw new Error("New pane was not selected");
  expect(addedPane?.startsWith(ids.tab + ":")).toBe(true);
  await picker.click();
  await expect(list.getByRole("group")).toHaveCount(1);
  await expect(list.getByRole("option")).toHaveCount(3);
  await picker.click();
  await ui.getByRole("button", { name: "New tab", exact: true }).click();
  await ui
    .getByRole("dialog", { name: "New tab", exact: true })
    .getByRole("button", { name: "Agent", exact: true })
    .click();
  await expect(picker).not.toHaveAttribute("data-value", addedPane);
  await picker.click();
  await expect(list.getByRole("group")).toHaveCount(2);
  await expect(list.getByRole("group").first().getByRole("option")).toHaveCount(3);
  await expect(list.getByRole("group").last().getByRole("option")).toHaveCount(1);
  await list.locator(`[data-value="${addedPane}"]`).click();
  await ui.getByRole("button", { name: "Tab and pane actions" }).click();
  await ui.getByRole("menuitem", { name: "Close pane…", exact: true }).click();
  await ui.getByRole("button", { name: "Close pane", exact: true }).click();
  await picker.click();
  await expect(list.getByRole("group")).toHaveCount(2);
  await expect(list.getByRole("group").first().getByRole("option")).toHaveCount(2);
});

test("compact account footer and machine management live in settings", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(ui.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Manage machines", exact: true })).toHaveCount(0);
  const height = await ui
    .locator(".mobile-sidebar-footer")
    .evaluate((footer) => footer.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(64);
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(ui.getByRole("option", { name: /Development/ })).toBeVisible();
  const bounds = await ui.getByRole("option", { name: /Development/ }).boundingBox();
  if (!bounds) throw new Error("Machine option is not visible");
  const client = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width * 0.8,
    y = bounds.y + bounds.height / 2;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - (bounds.width * 0.6 * step) / 8, y }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await ui.getByRole("option").first().press("Escape");
  await openSettings(ui);
  await choose(ui, "Settings section", "machines");
  await expect(
    ui
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByText("Development", { exact: true }),
  ).toBeVisible();
});
