import { expect, test, type Page, type FrameLocator } from "@playwright/test";
import { ids } from "../src/demo/fixtures";
import { swipe as touchSwipe } from "./support/swipe";
import { BINDINGS, isCompactCommand, shortcutLabel } from "../../desktop/src/shortcuts/bindings";
const workspace = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
const activeChat = `${ids.tab}:${ids.pane}`;
const activeTerminal = `${ids.tab}:${ids.terminalPane}`;
async function choose(ui: FrameLocator, label: string, value: string) {
  await ui.getByRole("combobox", { name: label, exact: true }).click();
  await ui
    .locator(
      `${label === "Tabs" ? "[data-pane-choice]" : '[role="option"]'}[data-value="${value}"]`,
    )
    .click();
}
async function openPicker(ui: FrameLocator) {
  const picker = ui.locator('[role="combobox"][aria-label="Tabs"]');
  if ((await picker.getAttribute("aria-expanded")) !== "true") await picker.click();
}
async function newTab(ui: FrameLocator) {
  await openPicker(ui);
  await ui
    .getByRole("dialog", { name: "Tabs", exact: true })
    .getByRole("button", { name: "New tab", exact: true })
    .click();
}
async function workspaceActions(ui: FrameLocator) {
  const value = await ui.locator('[role="combobox"][aria-label="Tabs"]').getAttribute("data-value");
  await openPicker(ui);
  const row = ui.locator(`.mobile-pane-row:has([data-pane-choice][data-value="${value}"])`);
  await row.getByRole("button", { name: /^Actions for tab / }).click();
}
async function paneCount(ui: FrameLocator, count: number) {
  await openPicker(ui);
  await expect(ui.locator("[data-pane-choice]")).toHaveCount(count);
  await ui.locator("[data-pane-choice]").first().press("Escape");
}
async function closePickerSheet(ui: FrameLocator, name = "Tabs") {
  const sheet = ui.getByRole("dialog", { name, exact: true });
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}
async function openSettings(ui: FrameLocator) {
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui
    .getByRole("dialog", { name: "Account", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
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
  await newTab(ui);
  await ui.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await paneCount(ui, 3);
});
async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.locator('meta[name="concors-source-revision"]')).toHaveAttribute(
    "content",
    /^[a-f0-9]{40,64}(-dirty)?$/,
  );
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
test("mobile header, terminal and host share one background across palettes and modes", async ({
  page,
}) => {
  // Five palette/mode checks with settings round trips through the native preference bridge.
  test.setTimeout(150_000);
  await page.emulateMedia({ colorScheme: "light" });
  const ui = await enter(page);
  const header = ui.locator(".mobile-header");
  await expect(header.getByRole("button", { name: "Project files", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Workspace actions", exact: true })).toHaveCount(
    0,
  );
  await choose(ui, "Tabs", activeTerminal);
  const terminal = ui.getByLabel("Terminal output", { exact: true });
  await expect(terminal).toBeVisible();
  const appearances = [
    ["Concors", "light", "rgb(244, 243, 239)"],
    ["Concors", "dark", "rgb(20, 20, 20)"],
    ["Cobalt", "dark", "rgb(16, 22, 37)"],
    ["Dusk", "dark", "rgb(26, 21, 37)"],
    ["Concors", "light", "rgb(244, 243, 239)"],
  ] as const;
  for (const [index, [palette, colorScheme, color]] of appearances.entries()) {
    if (index > 0) {
      await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await openSettings(ui);
      await choose(ui, "Settings section", "appearance");
      await ui.getByRole("radio", { name: palette, exact: true }).locator("..").click();
      await ui.getByRole("button", { name: "Theme", exact: true }).click();
      await ui
        .getByRole("menuitem", { name: colorScheme === "dark" ? "Dark" : "Light", exact: true })
        .click();
      await ui
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
    // The workspace wrapper is transparent for the swipe rim; .mobile-main
    // owns the opaque content background.
    await expect(ui.locator(".mobile-main")).toHaveCSS("background-color", color);
    await expect(terminal.locator("..")).toHaveCSS("background-color", color);
    // xterm sets this inline from its theme, so assert the renderer as well as pane CSS.
    await expect(terminal.locator(".xterm-scrollable-element")).toHaveCSS(
      "background-color",
      color,
    );
    const cyan = await terminal.evaluate(() => {
      const hex = getComputedStyle(document.documentElement)
        .getPropertyValue("--terminal-cyan")
        .trim();
      return `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
    });
    await expect(
      terminal.locator(".xterm-fg-6").filter({ hasText: "Concors demo terminal" }),
    ).toHaveCSS("color", cyan);
    if (palette !== "Concors") expect(cyan).not.toBe("rgb(121, 199, 212)");
    await expect(ui.locator(".mobile-terminal-controls")).toHaveCSS("background-color", color);
    await expect(page.locator('iframe[title="Concors workspace"]')).toHaveCSS(
      "background-color",
      color,
    );
    await expect(page.getByTestId("workspace-safe-area")).toHaveCSS("background-color", color);
    await page.screenshot({
      path: `apps/mobile/test-results/mobile-terminal-${palette}-${colorScheme}.png`,
    });
  }
  await choose(ui, "Tabs", activeChat);
  await expect(ui.getByLabel("Agent conversation", { exact: true })).toHaveCSS(
    "background-color",
    "rgb(244, 243, 239)",
  );
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
  await choose(ui, "Tabs", activeTerminal);
  await choose(ui, "Tabs", activeChat);
  await expect(composer).toHaveValue("A queued follow-up");
  await expect(ui.getByLabel("Remove notes.txt")).toBeVisible();
  await ui.getByRole("button", { name: "Queue message", exact: true }).click();
  await expect(ui.locator("[data-composer-queue]")).toContainText("A queued follow-up");
  await choose(ui, "Tabs", activeTerminal);
  await choose(ui, "Tabs", activeChat);
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
  await swipe(25, 285);
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await swipe(200, 25);
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
});
test("Files responds in the demo and terminal swipes keep both panels reachable", async ({
  page,
}) => {
  const ui = await enter(page);
  await choose(ui, "Tabs", activeTerminal);
  const terminal = ui.getByLabel("Terminal output", { exact: true });
  await expect(terminal).toBeVisible();
  const shell = ui.locator(".mobile-shell");
  const width = await shell.evaluate((element) => element.clientWidth);
  const files = ui.getByRole("region", { name: "Project files", exact: true });
  await ui.getByRole("button", { name: "Project files", exact: true }).click();
  await expect(files.getByRole("status")).toContainText("The demo has no filesystem");
  await files.getByRole("button", { name: "Back to chat" }).click();
  await expect(ui.locator(".mobile-files")).toHaveCSS(
    "transform",
    `matrix(1, 0, 0, 1, ${width}, 0)`,
  );
  await touchSwipe(page, { x: 170, y: 240 }, { x: 173, y: 480 });
  await expect(shell).toHaveAttribute("data-files-open", "false");
  await expect(shell).toHaveAttribute("data-sidebar-open", "false");
  await touchSwipe(page, { x: 100, y: 240 }, { x: 115, y: 240 });
  await expect(shell).toHaveAttribute("data-files-open", "false");
  await touchSwipe(page, { x: 335, y: 250 }, { x: 55, y: 250 });
  await expect(files.getByRole("status")).toContainText("The demo has no filesystem");
  await expect(shell).toHaveAttribute("data-sidebar-open", "false");
  await touchSwipe(page, { x: 70, y: 300 }, { x: 320, y: 300 });
  await expect(shell).toHaveAttribute("data-files-open", "false");
  await expect(ui.locator(".mobile-files")).toHaveCSS(
    "transform",
    `matrix(1, 0, 0, 1, ${width}, 0)`,
  );
  await touchSwipe(page, { x: 55, y: 250 }, { x: 335, y: 250 });
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  await touchSwipe(page, { x: 200, y: 240 }, { x: 30, y: 240 });
  await expect(shell).toHaveAttribute("data-sidebar-open", "false");
  await expect(ui.getByRole("combobox", { name: "Tabs" })).toHaveAttribute(
    "data-value",
    activeTerminal,
  );
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const popup = await ui
    .getByRole("button", { name: "Actions for Concors", exact: true })
    .boundingBox();
  if (!popup) throw new Error("Project menu trigger is missing");
  const y = popup.y + popup.height / 2;
  await touchSwipe(page, { x: popup.x + popup.width / 2, y }, { x: 30, y });
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  await expect(ui.getByRole("menu")).toBeVisible();
  await ui.getByRole("menu").press("Escape");
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
});
test("flat tab changes use the authoritative workspace operations", async ({ page }) => {
  const ui = await enter(page);
  await newTab(ui);
  await ui.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await workspaceActions(ui);
  await ui.getByRole("menuitem", { name: "Rename tab" }).click();
  await ui.getByRole("textbox", { name: "Tab name" }).fill("Second conversation");
  await ui.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Tabs" })).toContainText("Second conversation");
  await workspaceActions(ui);
  await expect(
    ui.getByRole("menuitem", { name: /Split|New pane|Arrange panes|Move tab/ }),
  ).toHaveCount(0);
  await ui.getByRole("menuitem", { name: "Close tab…", exact: true }).click();
  await ui.getByRole("button", { name: "Close tab", exact: true }).click();
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
  await expect(sidebar.getByText("Workspaces", { exact: true })).toBeVisible();
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
  // The moving workspace is a navigation surface, independent of control-corner preferences.
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(ui.getByTestId("mobile-workspace")).toHaveCSS("border-top-left-radius", "32px");
});
test("top select switches split panes and cold session links survive sign-in", async ({ page }) => {
  await page.goto(
    `/session?machineId=${ids.machine}&projectId=${ids.project}&sessionId=${ids.agent}`,
  );
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await choose(ui, "Tabs", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await ui.locator(".xterm-helper-textarea").pressSequentially("ls");
  await ui.locator(".xterm-helper-textarea").press("Enter");
  await expect(ui.locator(".xterm-accessibility-tree")).toContainText("ls");
  await choose(ui, "Tabs", activeChat);
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
test("folder workspaces and shared settings remain available from the sidebar", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await ui.getByRole("button", { name: "Open folder…", exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Folder path", exact: true })
    .fill("/home/demo/Phone project");
  await ui.getByRole("button", { name: "Go", exact: true }).click();
  await ui
    .getByRole("dialog", { name: "Open folder", exact: true })
    .getByRole("button", { name: "Open folder", exact: true })
    .click();
  await expect(ui.getByRole("dialog", { name: "Open folder" })).toHaveCount(0);
  await expect(ui.getByRole("combobox", { name: "Tabs" })).toContainText("Phone project");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
  await choose(ui, "Settings section", "notifications");
  await expect(ui.getByRole("checkbox", { name: "Push notifications" })).toBeDisabled();
  await ui.getByRole("combobox", { name: "Settings section", exact: true }).click();
  await expect(ui.getByRole("option", { name: "Billing", exact: true })).toHaveCount(0);
  await ui.getByRole("option").first().press("Escape");
  await choose(ui, "Settings section", "ssh-keys");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("SSH");
  await choose(ui, "Settings section", "advanced");
  await expect(ui.getByText("In-memory demo", { exact: true })).toBeVisible();
});
test("new workspace completion opens its own project and closes the sidebar", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Keep my original draft");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await ui.getByRole("button", { name: "New workspace", exact: true }).click();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(ui.getByRole("combobox", { name: "Tabs", exact: true })).toContainText(
    "New workspace",
  );
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Concors", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
    "Keep my original draft",
  );
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
    await ui.locator(".mobile-composer").evaluate(async (form) => {
      await Promise.all(
        form
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
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
    const chevronInside = await ui.getByRole("combobox", { name: "Tabs" }).evaluate((picker) => {
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

test("message history uses the shared mobile drawer and returns focus to its trigger", async ({
  page,
}) => {
  const ui = await enter(page);
  const trigger = ui.getByRole("button", { name: "Browse your messages", exact: true });
  await trigger.click();
  const dialog = ui.getByRole("dialog", { name: "Your messages", exact: true });
  await expect(dialog).toHaveAttribute("data-mobile-drawer", "true");
  await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "20px");
  const close = dialog.getByRole("button", { name: "Close messages", exact: true });
  await expect(close).toHaveCSS("width", "44px");
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          Math.abs(rect.bottom - window.innerHeight) < 2 &&
          rect.top >= 0 &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-messages-drawer.png") });
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // A hardware keyboard uses the same compact presentation as touch-triggered dialogs.
  await ui.getByRole("textbox", { name: "Message Codex" }).focus();
  await page.keyboard.press("Control+Shift+t");
  const shortcuts = ui.getByRole("dialog", { name: "Tab shortcuts", exact: true });
  await expect(shortcuts).toHaveAttribute("data-mobile-drawer", "true");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toHaveCount(0);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
});

test("search and project sheets animate above the open sidebar and restore focus", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const shell = ui.locator(".mobile-shell");
  await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
  const search = ui.getByRole("dialog", { name: "Search", exact: true });
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
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await ui.getByRole("button", { name: "Clone repository…", exact: true }).click();
  const project = ui.getByRole("dialog", { name: "Clone repository", exact: true });
  await expect(project).toHaveAttribute("data-mobile-drawer", "true");
  await project.getByRole("button", { name: "Paste a URL", exact: true }).click();
  await project
    .getByRole("textbox", { name: "Repository URL or local path" })
    .fill("Discard this draft");
  await project.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(project).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await ui.getByRole("button", { name: "Clone repository…", exact: true }).click();
  await expect(project).toHaveCSS("animation-name", "none");
  await project.getByRole("button", { name: "Paste a URL", exact: true }).click();
  await expect(project.getByRole("textbox", { name: "Repository URL or local path" })).toHaveValue(
    "",
  );
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
  await ui.getByRole("combobox", { name: "Tabs" }).tap();
  await expect(form).toHaveAttribute("data-expanded", "false");
  await closePickerSheet(ui);
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

test("flat tab picker opens a bottom sheet and dismisses without reopening", async ({ page }) => {
  const ui = await enter(page);
  const picker = ui.getByRole("combobox", { name: "Tabs" });
  const list = ui.getByRole("dialog", { name: "Tabs", exact: true });
  for (let i = 0; i < 3; i++) {
    const trigger = await picker.boundingBox();
    if (!trigger) throw new Error("Picker trigger is not visible");
    await picker.tap();
    await expect(list).toBeVisible();
    await expect(ui.getByRole("dialog", { name: "Tabs", exact: true })).toHaveAttribute(
      "data-mobile-drawer",
      "true",
    );
    await expect(list.locator(".mobile-tab-card")).toHaveCount(0);
    await expect(list.locator("[data-pane-choice]")).toHaveCount(2);
    // A second tap at the trigger's position lands on the modal scrim: close only.
    await page.touchscreen.tap(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
    await expect(list).toHaveCount(0);
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toBeFocused();
  }
  await picker.press("ArrowDown");
  await expect(list.locator("[data-pane-choice]").first()).toBeFocused();
  await list.locator("[data-pane-choice]").first().press("End");
  await expect(list.locator("[data-pane-choice]").last()).toBeFocused();
  await list.locator("[data-pane-choice]").last().press("Enter");
  await expect(picker).toHaveAttribute("data-value", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await choose(ui, "Tabs", activeChat);
  await newTab(ui);
  const drawer = ui.getByRole("dialog", { name: "New tab", exact: true });
  for (const name of ["Codex", "Claude Code", "OpenCode"]) {
    await expect(
      drawer.getByRole("button", { name, exact: true }).locator(".mobile-session-icon svg"),
    ).toHaveCount(1);
  }
  await expect(drawer.getByRole("button", { name: /Add pane/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  const added = await picker.getAttribute("data-value");
  if (!added) throw new Error("New tab was not selected");
  expect(added.startsWith(ids.tab + ":")).toBe(false);
  await picker.click();
  await expect(list.locator(".mobile-tab-card")).toHaveCount(0);
  await expect(list.locator("[data-pane-choice]")).toHaveCount(3);
  await expect(list.locator(".mobile-pane-choice")).toContainText([
    "Mobile launch · 1",
    "Mobile launch · 2",
    "Tab 2",
  ]);
  await closePickerSheet(ui);
  await workspaceActions(ui);
  await ui.getByRole("menuitem", { name: "Close tab…", exact: true }).click();
  await ui.getByRole("button", { name: "Close tab", exact: true }).click();
  await paneCount(ui, 2);
});

test("flat tab actions configure and close inactive leaves without changing the current selection", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ui = await enter(page);
  const picker = ui.getByRole("combobox", { name: "Tabs", includeHidden: true });
  await expect(
    ui.locator(".mobile-header").getByRole("button", { name: "Project files" }),
  ).toBeEnabled();
  await expect(ui.getByRole("button", { name: "Workspace actions", exact: true })).toHaveCount(0);
  await newTab(ui);
  await ui
    .getByRole("dialog", { name: "New tab", exact: true })
    .getByRole("button", { name: "Agent", exact: true })
    .click();
  await expect(picker).not.toHaveAttribute("data-value", activeChat);
  const selected = await picker.getAttribute("data-value");
  if (!selected) throw new Error("New tab was not selected");
  await picker.click();
  const drawer = ui.getByRole("dialog", { name: "Tabs", exact: true });
  const inactive = drawer.locator(`.mobile-pane-row:has([data-value="${activeTerminal}"])`);
  await inactive
    .getByRole("button", { name: "Actions for tab Mobile launch · 2", exact: true })
    .click();
  await expect(ui.getByRole("menuitem", { name: "Rename tab", exact: true })).toHaveCount(0);
  await expect(ui.getByRole("menuitem", { name: /Add pane|Move tab|Split/ })).toHaveCount(0);
  await ui.getByRole("menuitemradio", { name: "OpenCode", exact: true }).click();
  await expect(inactive.locator("[data-pane-choice]")).toContainText("OpenCode");
  await expect(picker).toHaveAttribute("data-value", selected);
  await page.screenshot({ path: test.info().outputPath("mobile-flat-tabs.png") });
  await inactive
    .getByRole("button", { name: "Actions for tab Mobile launch · 2", exact: true })
    .click();
  await ui.getByRole("menuitem", { name: "Close tab…", exact: true }).click();
  await ui.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(picker).toHaveAttribute("data-value", selected);
  await paneCount(ui, 2);
  await choose(ui, "Tabs", activeChat);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  // The old pane-close shortcut is a compatibility alias, not another mobile action.
  for (const prefix of ["p", "t"]) {
    await picker.press(`Control+Shift+${prefix}`);
    await picker.press("Backspace");
    await expect(ui.getByRole("dialog", { name: "Close tab?", exact: true })).toBeVisible();
    await ui.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await paneCount(ui, 2);
});

test("glass controls retain their shape and composer height animates with reduced-motion support", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.matches(".mobile-composer") && Array.isArray(keyframes)) {
        this.setAttribute("data-test-motion-from", String(keyframes[0]?.height));
        this.setAttribute("data-test-motion-to", String(keyframes.at(-1)?.height));
        this.setAttribute(
          "data-test-motion-count",
          String(Number(this.getAttribute("data-test-motion-count") ?? 0) + 1),
        );
      }
      return animate.call(this, keyframes, options);
    };
  });
  const ui = await enter(page);
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  const form = ui.locator(".mobile-composer");
  await input.click();
  await expect(form).toHaveAttribute("data-test-motion-count", "1");
  const sizes = await form.evaluate((el) => ({
    from: parseFloat(el.getAttribute("data-test-motion-from") ?? "0"),
    to: parseFloat(el.getAttribute("data-test-motion-to") ?? "0"),
  }));
  expect(sizes.to - sizes.from).toBeGreaterThan(40);
  await form.evaluate(async (el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))),
  );
  const alignment = await form.evaluate((el) => {
    const utility = el.querySelector(".mobile-composer-utilities")?.getBoundingClientRect();
    const action = el.querySelector(".mobile-composer-primary")?.getBoundingClientRect();
    return utility && action ? action.left - utility.right : null;
  });
  expect(alignment).toBe(0);
  const header = ui.locator(".mobile-header");
  await expect(header.getByRole("button")).toHaveCount(2);
  await expect(header.locator(".mobile-glass")).toHaveCount(3);
  await expect(header.getByRole("button", { name: "New tab", exact: true })).toHaveCount(0);
  const picker = ui.getByRole("combobox", { name: "Tabs" });
  const normal = await picker.evaluate((el) => ({
    radius: getComputedStyle(el).borderRadius,
    background: getComputedStyle(el).backgroundColor,
    blur: getComputedStyle(el).backdropFilter,
  }));
  expect(normal.background).toMatch(/(?:\/|,)\s*0\.38\)/);
  expect(normal.blur).toContain("blur(24px)");
  await picker.tap();
  const coveredPicker = ui.locator('.mobile-header [role="combobox"]');
  await expect(coveredPicker).toHaveCSS("border-radius", normal.radius);
  await expect(coveredPicker).toHaveCSS("background-color", normal.background);
  await expect(ui.locator(".mobile-picker-help")).toHaveCount(0);
  const list = ui.getByRole("dialog", { name: "Tabs", exact: true });
  expect(
    await list
      .locator("[data-pane-choice]")
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  await closePickerSheet(ui);
  await expect(form).toHaveAttribute("data-expanded", "false");
  await form.evaluate(async (el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))),
  );
  const animations = await form.getAttribute("data-test-motion-count");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await input.click();
  await expect(form).toHaveAttribute("data-expanded", "true");
  await expect(form).toHaveAttribute("data-test-motion-count", animations ?? "");
  expect(await form.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test("account opens a bottom drawer with settings, sign out and focus restoration", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(ui.locator(".mobile-sidebar-head")).not.toContainText("Concors");
  const account = ui.getByRole("button", { name: /^Account:/ });
  await account.click();
  const drawer = ui.getByRole("dialog", { name: "Account", exact: true });
  await expect(drawer).toHaveAttribute("data-mobile-drawer", "true");
  await expect(drawer).toHaveCSS("animation-name", "mobile-drawer-in");
  await expect(drawer.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Shortcuts/i })).toHaveCount(0);
  await expect(drawer.getByText("Personal organization", { exact: true })).toHaveCount(0);
  await expect(drawer.locator('[data-slot="dialog-description"]')).toHaveClass(/sr-only/);
  await expect(drawer.getByText("Alex Morgan", { exact: true })).toBeVisible();
  await expect(drawer.getByText("demo@concors.dev", { exact: true })).toBeVisible();
  const machine = drawer.getByRole("combobox", { name: "Machine", exact: true });
  await expect(machine).toContainText("Development");
  await machine.click();
  const machines = ui.getByRole("dialog", { name: "Machine", exact: true });
  await expect(machines.getByRole("option", { name: /Development/ })).toContainText("Connected");
  await machines.press("Escape");
  await expect(machine).toBeFocused();
  await drawer.getByRole("button", { name: "Add machine", exact: true }).click();
  const addMachine = ui.getByRole("dialog", { name: "Add machine", exact: true });
  await expect(drawer).toHaveCount(0);
  await expect(addMachine).toContainText("Creating machines is not available in mobile yet.");
  await expect(
    addMachine.getByRole("button", { name: "Refresh machines", exact: true }),
  ).toBeVisible();
  await addMachine.getByRole("button", { name: "Close", exact: true }).click();
  await expect(account).toBeFocused();
  await account.click();
  const bounds = await drawer.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    bottom: el.getBoundingClientRect().bottom,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }));
  expect(bounds.width).toBe(bounds.viewportWidth);
  expect(bounds.bottom).toBeGreaterThanOrEqual(bounds.viewportHeight);
  await drawer.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(account).toBeFocused();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await account.click();
  await drawer.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await account.click();
  await drawer.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore demo" })).toBeVisible();
});

test("sidebar has no logo or duplicate menu, with glass search behind the rounded glass workspace", async ({
  page,
}) => {
  const ui = await enter(page);
  const header = ui.getByRole("button", { name: "Open sidebar", exact: true });
  const glass = await header.evaluate((element) => {
    const style = getComputedStyle(element);
    return { blur: style.backdropFilter, radius: style.borderRadius, shadow: style.boxShadow };
  });
  const sidebar = ui.locator("#mobile-sidebar");
  const workspace = ui.getByTestId("mobile-workspace");
  const main = workspace.locator(".mobile-main");
  const closedSize = await main.evaluate((element) => [element.clientWidth, element.clientHeight]);
  const rim = () =>
    workspace.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return {
        opacity: style.opacity,
        blur: style.backdropFilter,
        pointerEvents: style.pointerEvents,
      };
    });
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(sidebar).toHaveCSS("isolation", "isolate");
  await expect(sidebar).toHaveCSS("overflow", "hidden");
  await expect(sidebar).toHaveCSS("z-index", "0");
  await expect(workspace).toHaveCSS("z-index", "1");
  await expect(workspace).toHaveCSS("border-top-left-radius", "0px");
  await expect
    .poll(rim)
    .toEqual({ opacity: "0", blur: "blur(18px) saturate(1.5)", pointerEvents: "none" });
  await header.click();
  await expect(sidebar.getByRole("img", { name: "Concors", exact: true })).toHaveCount(0);
  await expect(sidebar.locator(".mobile-sidebar-head button")).toHaveCount(1);
  await expect(sidebar.locator('button[aria-label*="sidebar"]')).toHaveCount(0);
  await expect(workspace).toHaveCSS("border-top-left-radius", "32px");
  await expect(workspace).toHaveCSS("border-bottom-left-radius", "32px");
  await expect(workspace).toHaveCSS("overflow", "hidden");
  await expect
    .poll(rim)
    .toEqual({ opacity: "1", blur: "blur(18px) saturate(1.5)", pointerEvents: "none" });
  await expect(main).toHaveCSS("clip-path", "inset(3px round 29px)");
  expect(await main.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual(
    closedSize,
  );
  await page.screenshot({
    path: "apps/mobile/test-results/mobile-workspace-glass-light.png",
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "apps/mobile/test-results/mobile-workspace-glass-dark.png",
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect.poll(async () => (await rim()).blur).toBe("none");
  await expect(main).toHaveCSS("transition-duration", "0s");
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
    forcedColors: "none",
  });
  const search = ui.getByRole("button", { name: "Search workspace", exact: true });
  await expect(search).toHaveClass(/mobile-glass/);
  await expect(search).toHaveCSS("backdrop-filter", glass.blur);
  await expect(search).toHaveCSS("border-radius", glass.radius);
  await expect(search).toHaveCSS("box-shadow", glass.shadow);
  await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
  await expect(ui.getByPlaceholder("Search workspaces, agents, tabs…")).toBeVisible();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await page.keyboard.press("Escape");
  await expect(ui.getByRole("button", { name: "Search workspace", exact: true })).toBeFocused();
  await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
  await expect(workspace).toHaveCSS("border-top-left-radius", "0px");
  await expect(main).toHaveCSS("clip-path", "inset(0px)");
  await expect.poll(async () => (await rim()).opacity).toBe("0");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(ui.getByRole("button", { name: "Search workspace", exact: true })).toHaveCount(0);
});

test("mobile Shortcuts settings preserve supported commands and all entry points", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
  await choose(ui, "Settings section", "shortcuts");
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { level: 2 })).toHaveText([
    "Settings",
    "Workspace",
    "Tabs",
  ]);
  await expect(settings).toContainText("With an external keyboard");
  await expect(settings).toContainText("Move through the flat Tabs list.");
  const bindings = BINDINGS.filter((binding) => isCompactCommand(binding.id));
  await expect(settings.locator("dt")).toHaveCount(bindings.length);
  for (const binding of bindings) {
    const row = settings.locator("dt").filter({ hasText: binding.label }).locator("..");
    await expect(row.locator("kbd")).toHaveText(shortcutLabel(binding.id, false));
  }
  await expect(settings.getByText("New pane beside current", { exact: true })).toHaveCount(0);
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  await input.press("Control+Shift+/");
  await expect(settings.getByRole("combobox", { name: "Settings section" })).toHaveAttribute(
    "data-value",
    "shortcuts",
  );
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await input.press("Control+Shift+k");
  await ui.getByPlaceholder("Search workspaces, agents, tabs…").fill("Shortcuts");
  await ui.getByRole("option", { name: /Shortcuts/ }).click();
  await expect(settings.getByRole("combobox", { name: "Settings section" })).toHaveAttribute(
    "data-value",
    "shortcuts",
  );
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
  await expect(
    ui.getByRole("button", { name: /Billing portal|Add card|Subscribe|Cancel subscription/ }),
  ).toHaveCount(0);
  await choose(ui, "Settings section", "machines");
  await expect(
    ui.getByRole("button", { name: /Create machine|Add machine|Cancel machine|Resume machine/ }),
  ).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Refresh machines", exact: true })).toBeVisible();
  await expect(
    ui
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByText("Development", { exact: true }),
  ).toBeVisible();
});

test("machine sheet preserves the sidebar, selected status, and focus", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const picker = ui.getByRole("combobox", { name: "Machine", exact: true });
  await picker.click();
  const sheet = ui.getByRole("dialog", { name: "Machine", exact: true });
  await expect(sheet).toHaveAttribute("data-mobile-drawer", "true");
  await expect(sheet).toHaveCSS("animation-name", "mobile-drawer-in");
  const selected = sheet.getByRole("option", { name: /Development/ });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(selected).toContainText("Connected");
  await selected.click();
  await expect(sheet).toHaveCount(0);
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  await expect(picker).toBeFocused();
  await picker.click();
  await sheet.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(picker).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await picker.click();
  await expect(sheet).toHaveCSS("animation-name", "none");
  await closePickerSheet(ui, "Machine");
});
