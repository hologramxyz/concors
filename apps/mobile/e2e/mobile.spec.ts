import { expect, test, type Page, type FrameLocator, type Locator } from "@playwright/test";
import { ids, SIDEBAR_TREE_FLAG, TERMINAL_PROFILE_FLAG, treeIds } from "../src/demo/fixtures";
import { hold, swipe as touchSwipe, scrollTimelineUp } from "./support/swipe";
import { BINDINGS, isCompactCommand } from "../../desktop/src/shortcuts/bindings";
import {
  bindingLabel,
  defaultKeymap,
  mainBinding,
  strokeLabel,
  usableBindings,
} from "../../desktop/src/shortcuts/keymap";
const workspace = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
const activeChat = `${ids.tab}:${ids.pane}`;
/** A tab's row under its workspace in the sidebar, which opens the tab. */
const tabRow = (ui: FrameLocator, title: string, workspaceName = "Concors") =>
  ui
    .getByRole("list", { name: `${workspaceName} tabs`, exact: true })
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("button")
    .first();
const activeTerminal = `${ids.tab}:${ids.terminalPane}`;
/** The phone's tab strip under the header, and one of its tabs by `tabId:paneId`. */
const tabStrip = (ui: FrameLocator) => ui.getByRole("group", { name: "Tabs", exact: true });
const stripTab = (ui: FrameLocator, value: string) =>
  ui.locator(`.mobile-tab-strip [data-pane-choice][data-value="${value}"]`);
/** The header's workspace name, which opens the workspace switcher. */
const switcher = (ui: FrameLocator) => ui.getByRole("button", { name: /^Workspace: / });
const currentTab = (ui: FrameLocator) =>
  ui.locator('.mobile-tab-strip [data-pane-choice][aria-pressed="true"]');
async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Element is not visible");
  return bounds;
}
/** The strip hides while the composer is typed in; closing the keyboard brings it back. */
async function closeKeyboard(ui: FrameLocator) {
  const composer = ui.locator('.mobile-composer[data-expanded="true"]');
  if (!(await composer.count())) return;
  await ui.getByRole("log", { name: "Chat timeline" }).click({ position: { x: 200, y: 300 } });
  await expect(composer).toHaveCount(0);
}
async function choose(ui: FrameLocator, label: string, value: string) {
  if (label === "Tabs") {
    await closeKeyboard(ui);
    await stripTab(ui, value).click();
    await expect(stripTab(ui, value)).toHaveAttribute("aria-pressed", "true");
    return;
  }
  await ui.getByRole("combobox", { name: label, exact: true }).click();
  await ui.locator(`[role="option"][data-value="${value}"]`).click();
}
async function newTab(ui: FrameLocator) {
  await closeKeyboard(ui);
  await tabStrip(ui).getByRole("button", { name: "New tab", exact: true }).click();
}
/** A tab's "…" sheet, through the button a screen reader finds beside it (long-press elsewhere). */
async function tabActions(ui: FrameLocator, value: string) {
  await ui
    .locator(`.mobile-tab-strip [data-tab-id="${value}"]`)
    .getByRole("button", { name: /^More actions for / })
    .press("Enter");
}
async function workspaceActions(ui: FrameLocator) {
  const value = await currentTab(ui).getAttribute("data-value");
  await tabActions(ui, value ?? "");
}
/**
 * The New tab sheet as desktop's "+" menu lists it: the chat, then everything that runs in a
 * terminal, all with the terminal mark, then resuming a chat; no descriptions under the rows.
 */
async function expectNewTabGroups(sheet: Locator, terminals: string[]) {
  await expect(sheet.getByRole("group", { name: "Chat" }).getByRole("button")).toHaveText([
    "New chat",
  ]);
  const terminal = sheet.getByRole("group", { name: "In a terminal" });
  await expect(terminal.getByRole("button")).toHaveText(terminals);
  await expect(terminal.locator("button svg")).toHaveCount(terminals.length);
  await expect(terminal.locator("button svg:not(.lucide-terminal)")).toHaveCount(0);
  await expect(sheet.getByRole("separator")).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "Resume a chat…", exact: true })).toBeVisible();
  await expect(sheet).not.toContainText(/synced with your desktop|interactive terminal|Reopen a/);
  for (const box of await sheet
    .locator(".mobile-select-option")
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
    expect(box).toBeGreaterThanOrEqual(44);
}
async function paneCount(ui: FrameLocator, count: number) {
  await expect(tabStrip(ui).locator("[data-pane-choice]")).toHaveCount(count);
}
async function closePickerSheet(ui: FrameLocator, name = "Tabs") {
  const sheet = ui.getByRole("dialog", { name, exact: true });
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}
/** Emulated phones keep the host's navigator.platform, so shortcut labels follow the runner. */
const macLabels = (ui: FrameLocator) =>
  ui.locator("body").evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
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
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
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
test("your message bubble stands out from the phone's light background", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const ui = await enter(page);
  const bubble = ui
    .locator("article")
    .filter({ hasText: "Help me get the mobile client ready to test." });
  const contrast = await bubble.evaluate((element) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable");
    const paint = (...layers: string[]) => {
      for (const layer of layers) {
        context.fillStyle = layer;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05;
    };
    const background = getComputedStyle(document.documentElement).getPropertyValue("--background");
    const page = luminance(paint(background));
    const fill = luminance(paint(background, getComputedStyle(element).backgroundColor));
    return Math.max(page, fill) / Math.min(page, fill);
  });
  // The shared raised fill measures 1.27 here; the muted fill it replaced measured 1.000.
  expect(contrast).toBeGreaterThan(1.03);
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
    if (control === "Thinking effort")
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
test("composer options hold effort and permissions, with desktop wording and quiet menus", async ({
  page,
}) => {
  const ui = await enter(page);
  const input = ui.locator("[data-agent-composer]");
  await expect(input).toHaveAttribute("placeholder", "Add a follow-up to the queue…");
  await newTab(ui);
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(input).toHaveAttribute("placeholder", "Ask anything…");
  await input.click();
  await expect(input).toHaveAttribute("placeholder", "Ask anything…");

  const form = ui.locator(".mobile-composer");
  const gaps = await form.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    const button = element
      .querySelector(".mobile-composer-primary button")
      ?.getBoundingClientRect();
    return button && [outer.right - button.right, outer.bottom - button.bottom];
  });
  expect(gaps?.[0]).toBeGreaterThanOrEqual(8);
  expect(gaps?.[0]).toBeCloseTo(gaps?.[1] ?? 0, 0);
  for (const name of ["Thinking effort", "Permission mode"]) {
    await expect(form.getByRole("button", { name, exact: true })).toHaveCount(0);
  }

  await ui.getByRole("button", { name: "More composer options" }).click();
  const sheet = ui.locator(".mobile-composer-options");
  await expect(sheet.getByText("Conversation options")).toHaveCount(0);
  for (const [name, selected] of [
    ["Thinking effort", "Medium"],
    ["Permission mode", "Default permissions"],
  ] as const) {
    await sheet.getByRole("button", { name, exact: true }).click();
    const menu = ui.getByRole("listbox", { name, exact: true });
    await expect(menu).toBeVisible();
    // Few enough to read at a glance, with nothing highlighted but the current value's check.
    await expect(ui.getByRole("combobox", { name: /^Search/ })).toHaveCount(0);
    await expect(menu.locator(".bg-accent")).toHaveCount(0);
    await expect(menu.locator(".lucide-check")).toHaveCount(1);
    await expect(menu.getByRole("option", { selected: true })).toContainText(selected);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
  await ui.getByRole("button", { name: "Agent and model", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Search models" })).toBeVisible();
});
test("an attachment keeps its remove button inside its corner, with a fingertip's tap area", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.locator("[data-agent-composer]").click();
  await ui.locator('input[aria-label="Upload files"]').setInputFiles({
    name: "notes-for-the-release.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Notes\n"),
  });
  const chip = ui.locator("[data-composer-attachment]");
  await expect(chip.getByText("notes-for-the-release.md")).toBeVisible();
  const metrics = await chip.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    const remove = element.querySelector(".mobile-attachment-remove");
    const rect = remove?.getBoundingClientRect();
    const name = element.querySelector(".truncate");
    if (!rect || !name) return null;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      inside:
        rect.left >= outer.left &&
        rect.top >= outer.top &&
        rect.right <= outer.right &&
        rect.bottom <= outer.bottom,
      tap: [
        [-21, -21],
        [21, -21],
        [-21, 21],
        [21, 21],
      ].every(([x = 0, y = 0]) => {
        const hit = document.elementFromPoint(centerX + x, centerY + y);
        return hit?.closest(".mobile-attachment-remove") === remove;
      }),
      nameRoom: name.clientWidth > 100,
    };
  });
  expect(metrics).toEqual({ inside: true, tap: true, nameRoom: true });
});
test("Android composer keeps the model picker open when returning to providers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const message = event.data?.concorsMobile;
      if (window.parent !== window && message?.type === "state") {
        // Match the Android WebView host: native platform services, shared DOM controls.
        message.state.native = true;
        message.state.nativeChrome = false;
      }
    });
  });
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Keep my draft");
  const trigger = ui.getByRole("button", { name: "Agent and model", exact: true });
  await trigger.click();
  for (let visit = 0; visit < 2; visit++) {
    await ui.getByRole("button", { name: "Back to providers", exact: true }).click();
    const providers = ui.getByRole("listbox", { name: "Providers", exact: true });
    await expect(providers).toBeVisible();
    // Back re-renders the menu under the tap; the composer stays open around its picker, or the
    // picker loses its anchor and jumps away from the next tap.
    await expect(ui.locator(".mobile-composer")).toHaveAttribute("data-expanded", "true");
    await expect(ui.getByRole("combobox", { name: "Search providers" })).toBeVisible();
    await providers.getByRole("option", { name: /^Codex\b/ }).click();
    await expect(ui.getByRole("listbox", { name: "Models", exact: true })).toBeVisible();
  }
  await ui.getByRole("option", { name: "Codex", exact: true }).click();
  await expect(ui.getByRole("listbox", { name: "Models", exact: true })).toHaveCount(0);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue("Keep my draft");
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
  await expect(currentTab(ui)).toHaveAttribute("data-value", activeTerminal);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const popup = await ui
    .getByRole("button", { name: "Actions for Concors", exact: true })
    .boundingBox();
  if (!popup) throw new Error("Project menu trigger is missing");
  const y = popup.y + popup.height / 2;
  await touchSwipe(page, { x: popup.x + popup.width / 2, y }, { x: 30, y });
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
  // Row menus open as sheets on a tap, as the phone's other sheets do, so a swipe opens none.
  await expect(ui.getByRole("menu")).toHaveCount(0);
  await ui.getByRole("button", { name: "Actions for Concors", exact: true }).click();
  await expect(ui.getByRole("menu")).toBeVisible();
  await ui.getByRole("menu").press("Escape");
  await expect(ui.getByRole("menu")).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-sidebar-open", "true");
});
test("flat tab changes use the authoritative workspace operations", async ({ page }) => {
  const ui = await enter(page);
  await newTab(ui);
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await workspaceActions(ui);
  await ui.getByRole("menuitem", { name: "Rename tab" }).click();
  await ui.getByRole("textbox", { name: "Tab name" }).fill("Second conversation");
  await ui.getByRole("button", { name: "Save", exact: true }).click();
  await expect(currentTab(ui)).toContainText("Second conversation");
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
  // Chats are listed under their workspace, as on desktop, not in a section of their own.
  await expect(sidebar.getByText("Agents", { exact: true })).toHaveCount(0);
  await expect(tabRow(ui, "Mobile launch")).toBeVisible();
  await expect(sidebar.getByText("Previews", { exact: true })).toBeVisible();
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
  // The moving workspace rim follows the same corner preference as its content.
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(ui.getByTestId("mobile-workspace")).toHaveCSS("border-top-left-radius", "0px");
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
  await expect(ui.locator(".xterm-rows")).toContainText("ls");
  await choose(ui, "Tabs", activeChat);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  // Sign out lives in the Account drawer; account settings no longer repeat it.
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui
    .getByRole("dialog", { name: "Account", exact: true })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
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
  // The demo turn is still live, so the chat stays pinned until the reader scrolls up to them.
  await scrollTimelineUp(page, ui.getByRole("log", { name: "Chat timeline" }), 400);
  await expect(ui.getByRole("button", { name: "Latest", exact: true })).toBeVisible();
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
  await expect(switcher(ui)).toContainText("Phone project");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
  await choose(ui, "Settings section", "notifications");
  await expect(ui.getByRole("checkbox", { name: "Push notifications" })).toBeDisabled();
  // One section, as on desktop: push sits beside sound rather than under a second heading.
  await expect(ui.getByRole("heading", { name: "Agent notifications" })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("mobile-notifications.png") });
  await ui.getByRole("combobox", { name: "Settings section", exact: true }).click();
  await expect(ui.getByRole("option", { name: "Billing", exact: true })).toHaveCount(0);
  await ui.getByRole("option").first().press("Escape");
  await choose(ui, "Settings section", "ssh-keys");
  await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toContainText("SSH");
  await choose(ui, "Settings section", "about");
  await expect(ui.getByText("Version", { exact: true })).toBeVisible();
});
test("new workspace completion opens its own project and closes the sidebar", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Keep my original draft");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await ui.getByRole("button", { name: "New workspace", exact: true }).click();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(switcher(ui)).toContainText("New workspace");
  // An empty workspace starts its first tab from its row's menu.
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Actions for New workspace", exact: true }).click();
  await ui.getByRole("menuitem", { name: "New tab", exact: true }).click();
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await expect(ui.locator('[aria-label="New workspace tabs"] > li')).toHaveCount(1);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await tabRow(ui, "Mobile launch").click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
    "Keep my original draft",
  );
});
test("returning to the app keeps the connection and an unsent draft", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).fill("Do not lose this draft");
  const visibility = async (value: string) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, value);
  await visibility("hidden");
  await visibility("visible");
  // The connection stays open in the background, so coming back needs no reconnect.
  await page.waitForTimeout(2_500);
  await expect(ui.getByText("Reconnecting… Saved workspace is read-only.")).toHaveCount(0);
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
          width: rect.width,
          height: rect.height,
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
    for (const rect of metrics) expect(rect.width).toBe(44);
    expect(metrics.map((rect) => rect.height)).toEqual(metrics.map(() => 44));
    await expect(ui.getByRole("button", { name: "Agent and model", exact: true })).toHaveText("");
    // The header names the workspace; the tab's name is on the strip under it.
    await expect(switcher(ui)).toHaveText("Concors");
    const chevronInside = await switcher(ui).evaluate((picker) => {
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
  await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
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
  const shortcuts = ui.getByRole("dialog", { name: "Tab", exact: true });
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
  expect(collapsedBounds.height).toBeLessThanOrEqual(62);
  await input.click();
  await expect(form).toHaveAttribute("data-expanded", "true");
  for (const name of [
    "Agent and model",
    "More composer options",
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
  await switcher(ui).tap();
  await expect(form).toHaveAttribute("data-expanded", "false");
  await closePickerSheet(ui, "Workspaces");
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

test("the workspace switcher opens from its text and padding and dismisses without reopening", async ({
  page,
}) => {
  const ui = await enter(page);
  const picker = switcher(ui);
  const list = ui.getByRole("dialog", { name: "Workspaces", exact: true });
  // Android/web use this DOM button; exercise its text, padding and the chevron.
  for (const [x, y] of [
    [0.2, 0.3],
    [0.2, 0.7],
    [0.03, 0.5],
    [0.5, 0.05],
    [0.5, 0.95],
    [0.95, 0.5],
  ] as const) {
    const trigger = await picker.boundingBox();
    if (!trigger) throw new Error("Workspace switcher is not visible");
    await picker.tap({ position: { x: trigger.width * x, y: trigger.height * y } });
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute("data-mobile-drawer", "true");
    await expect(list.locator("[data-workspace-choice]")).toHaveText(["Concors"]);
    // A second tap at the trigger's position lands on the modal scrim: close only.
    await page.touchscreen.tap(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2);
    await expect(list).toHaveCount(0);
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toBeFocused();
  }
  await picker.press("Enter");
  await expect(list.locator('[aria-current="page"]')).toBeFocused();
  await list.locator('[aria-current="page"]').press("Escape");
  await expect(list).toHaveCount(0);
  await expect(picker).toBeFocused();
});

test("tapping a strip tab shows it, and + opens the New tab sheet", async ({ page }) => {
  const ui = await enter(page);
  await expect(tabStrip(ui).locator("[data-pane-choice]")).toHaveText([
    "Mobile launch 1",
    "Mobile launch 2",
  ]);
  await expect(currentTab(ui)).toHaveAttribute("data-value", activeChat);
  await stripTab(ui, activeTerminal).tap();
  await expect(currentTab(ui)).toHaveAttribute("data-value", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  // The selected fill marks the current tab, and only that one.
  await expect(ui.locator(".mobile-tab-strip [data-active-tab]")).toHaveCount(1);
  await expect(ui.locator(`.mobile-tab-strip [data-tab-id="${activeTerminal}"]`)).toHaveAttribute(
    "data-active-tab",
    "",
  );
  await choose(ui, "Tabs", activeChat);
  await newTab(ui);
  const drawer = ui.getByRole("dialog", { name: "New tab", exact: true });
  await expectNewTabGroups(drawer, ["Terminal", "Claude Code", "Codex", "OpenCode"]);
  await expect(drawer.getByRole("button", { name: /Add pane/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  const added = await currentTab(ui).getAttribute("data-value");
  if (!added) throw new Error("New tab was not selected");
  expect(added.startsWith(ids.tab + ":")).toBe(false);
  await expect(tabStrip(ui).locator("[data-pane-choice]")).toHaveText([
    "Mobile launch 1",
    "Mobile launch 2",
    "Tab 2",
  ]);
  // Closing the sheet hands focus back to "+", not to the first tab.
  await newTab(ui);
  await closePickerSheet(ui, "New tab");
  await expect(tabStrip(ui).getByRole("button", { name: "New tab", exact: true })).toBeFocused();
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
  const picker = currentTab(ui);
  await expect(
    ui.locator(".mobile-header").getByRole("button", { name: "Project files" }),
  ).toBeEnabled();
  await expect(ui.getByRole("button", { name: "Workspace actions", exact: true })).toHaveCount(0);
  await newTab(ui);
  await ui
    .getByRole("dialog", { name: "New tab", exact: true })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(picker).not.toHaveAttribute("data-value", activeChat);
  const selected = await picker.getAttribute("data-value");
  if (!selected) throw new Error("New tab was not selected");
  await tabActions(ui, activeTerminal);
  await expect(ui.getByRole("dialog", { name: "Mobile launch 2", exact: true })).toBeVisible();
  await expect(ui.getByRole("menuitem", { name: "Rename tab", exact: true })).toHaveCount(0);
  await expect(ui.getByRole("menuitem", { name: /Add pane|Move tab|Split/ })).toHaveCount(0);
  await ui.getByRole("menuitemradio", { name: "OpenCode", exact: true }).click();
  await expect(picker).toHaveAttribute("data-value", selected);
  await page.screenshot({ path: test.info().outputPath("mobile-flat-tabs.png") });
  // The tab shows its name only, so its new type shows as the menu's choice.
  await tabActions(ui, activeTerminal);
  await expect(ui.getByRole("menuitemradio", { name: "OpenCode", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
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

test("tab menus pin, fork and delete chats with desktop's actions, and undo a delete", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ui = await enter(page);
  const picker = currentTab(ui);
  const menuItems = () => ui.locator('[role="menu"]').getByRole("menuitem").allTextContents();
  // The demo's first chat waits on an approval, and a busy chat cannot fork, so use a new one.
  await newTab(ui);
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  const chat = await picker.getAttribute("data-value");
  if (!chat) throw new Error("New chat was not selected");

  // A terminal has no chat to pin, fork or delete.
  await tabActions(ui, activeTerminal);
  expect(await menuItems()).toEqual(["Close tab…"]);
  await ui.locator('[role="menu"]').press("Escape");

  await tabActions(ui, chat);
  expect(await menuItems()).toEqual(["Pin", "Rename tab", "Fork chat", "Close tab…", "Delete…"]);
  await ui.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await tabActions(ui, chat);
  await expect(ui.getByRole("menuitem", { name: "Unpin", exact: true })).toBeVisible();

  // The fork opens in a tab of its own and is shown.
  await ui.getByRole("menuitem", { name: "Fork chat", exact: true }).click();
  await expect(ui.getByRole("menu")).toHaveCount(0);
  await expect(picker).not.toHaveAttribute("data-value", chat);
  const fork = await picker.getAttribute("data-value");
  await paneCount(ui, 4);

  await workspaceActions(ui);
  await ui.getByRole("menuitem", { name: "Delete…", exact: true }).click();
  const confirm = ui.getByRole("dialog", { name: /^Delete “/ });
  await expect(confirm).toContainText("You’ll have a few seconds to undo.");
  // The menu sheet closes before the confirm opens, so it shows alone.
  await expect(ui.getByRole("dialog")).toHaveCount(1);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  const toast = ui.getByRole("status").filter({ hasText: "Chat deleted" });
  await expect(toast).toBeVisible();
  await expect(picker).not.toHaveAttribute("data-value", fork ?? "");
  await paneCount(ui, 3);
  // Undo brings the tab back and, as it was shown, shows it again.
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(toast).toHaveCount(0);
  await paneCount(ui, 4);
  await expect(picker).not.toHaveAttribute("data-value", chat);

  // The sidebar's tab rows open desktop's sidebar menu as a sheet: no tab type or close, which
  // are the tab's own.
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui
    .getByRole("dialog", { name: "Workspace sidebar" })
    .getByRole("button", { name: /^Actions for .*\(fork\)$/ })
    .click();
  expect(await menuItems()).toEqual(["Pin", "Rename tab", "Fork chat", "Delete"]);
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
  const header = ui.locator(".mobile-header-row");
  await expect(header.getByRole("button")).toHaveCount(3);
  await expect(header.locator(".mobile-glass")).toHaveCount(3);
  await expect(header.getByRole("button", { name: "New tab", exact: true })).toHaveCount(0);
  const picker = switcher(ui);
  const normal = await picker.evaluate((el) => ({
    radius: getComputedStyle(el).borderRadius,
    background: getComputedStyle(el).backgroundColor,
    blur: getComputedStyle(el).backdropFilter,
  }));
  expect(normal.background).toMatch(/(?:\/|,)\s*0\.38\)/);
  expect(normal.blur).toContain("blur(24px)");
  await picker.tap();
  const coveredPicker = ui.locator(".mobile-header .mobile-picker");
  await expect(coveredPicker).toHaveCSS("border-radius", normal.radius);
  await expect(coveredPicker).toHaveCSS("background-color", normal.background);
  await expect(ui.locator(".mobile-picker-help")).toHaveCount(0);
  const list = ui.getByRole("dialog", { name: "Workspaces", exact: true });
  expect(
    await list
      .locator("[data-workspace-choice]")
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  await closePickerSheet(ui, "Workspaces");
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
  await expect(drawer.getByRole("combobox", { name: "Machine", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /Add machine|Manage machines/ })).toHaveCount(0);
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
    .toEqual({ opacity: "0", blur: "blur(12px) saturate(1.1)", pointerEvents: "none" });
  await header.click();
  await expect(sidebar.getByRole("img", { name: "Concors", exact: true })).toHaveCount(0);
  await expect(sidebar.locator(".mobile-sidebar-head button")).toHaveCount(2);
  await expect(sidebar.locator('button[aria-label*="sidebar"]')).toHaveCount(0);
  await expect(workspace).toHaveCSS("border-top-left-radius", "32px");
  await expect(workspace).toHaveCSS("border-bottom-left-radius", "32px");
  await expect(workspace).toHaveCSS("overflow", "hidden");
  await expect
    .poll(rim)
    .toEqual({ opacity: "1", blur: "blur(12px) saturate(1.1)", pointerEvents: "none" });
  await expect(main).toHaveCSS("clip-path", "inset(1px round 31px)");
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
  await expect(ui.getByPlaceholder("Search workspaces and tabs…")).toBeVisible();
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
    "Keyboard shortcuts",
    "Follow-ups",
    "Workspace",
    "Agent chat",
    "Tabs",
  ]);
  await expect(settings).toContainText("An external keyboard");
  await expect(settings).toContainText("Move through the tabs in the strip under the header.");
  const mac = await macLabels(ui);
  const bindings = BINDINGS.filter((binding) => isCompactCommand(binding.id));
  await expect(settings.locator("dt")).toHaveCount(bindings.length);
  for (const binding of bindings) {
    const row = settings.locator("dt").filter({ hasText: binding.label }).locator("..");
    // The main shortcut as a chip per press; any others follow in words.
    const keymap = defaultKeymap(mac)[binding.id];
    const main = mainBinding(keymap, false);
    if (!main) throw new Error(`${binding.id} has no shortcut`);
    // A Mac draws its modifiers as icons, so only the plain labels can be compared as text.
    await expect(row.locator("kbd")).toHaveCount(main.keys.length);
    if (!mac)
      await expect(row.locator("kbd")).toHaveText(main.keys.map((stroke) => strokeLabel(stroke)));
    if (!mac)
      for (const other of usableBindings(keymap, false).filter((entry) => entry !== main))
        await expect(row).toContainText(bindingLabel(other, mac));
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
  await ui.getByPlaceholder("Search workspaces and tabs…").fill("Shortcuts");
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
    ui.getByRole("button", { name: /Create machine|Cancel machine|Resume machine/ }),
  ).toHaveCount(0);
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  // Desktop's Machines page, without buying, cancelling, prices or payment warnings.
  const machines = settings.getByRole("region", { name: "Machines", exact: true });
  await expect(machines).toContainText("Your development machines.");
  await expect(machines.getByText("Development", { exact: true })).toBeVisible();
  await expect(machines.getByRole("button", { name: /^(Connect|Open)$/ })).toBeVisible();
  await expect(
    machines.getByRole("button", { name: /New machine|Cancel |Keep machine/ }),
  ).toHaveCount(0);
  await expect(machines).not.toContainText("/mo");
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole("combobox", { name: "Settings section" }).click();
  await expect(ui.getByRole("option", { name: "Machines", exact: true })).toHaveCount(1);
  await ui.getByRole("option", { name: "Machines", exact: true }).click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
  await ui.getByPlaceholder("Search workspaces and tabs…").fill("Go to Machines");
  await ui.getByRole("option", { name: "Go to Machines", exact: true }).click();
  await expect(settings.getByRole("combobox", { name: "Settings section" })).toHaveAttribute(
    "data-value",
    "machines",
  );
  await expect(settings.getByRole("region", { name: "Machines", exact: true })).toBeVisible();
});

test("focus that follows a tap shows no ring until a key is pressed", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui
    .getByRole("dialog", { name: "Account", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const picker = ui
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("combobox", { name: "Settings section" });
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute("data-pointer-focus", "");
  await expect(picker).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(picker).toBeFocused();
  await expect(picker).not.toHaveAttribute("data-pointer-focus", "");
  await expect(picker).toHaveCSS("outline-style", "solid");
});

test("machine sheet preserves the sidebar, selected status, and focus", async ({ page }) => {
  const ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const picker = ui.getByRole("combobox", { name: "Machine", exact: true });
  await picker.click();
  const sheet = ui.getByRole("dialog", { name: "Machine", exact: true });
  await expect(sheet).toHaveAttribute("data-mobile-drawer", "true");
  await expect(sheet).toHaveCSS("animation-name", "mobile-drawer-in");
  // The status is only spoken: a check mark on this row, a dot on the others.
  const selected = sheet.getByRole("option", { name: "Development Connected", exact: true });
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(selected).not.toContainText("Connected");
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

test("sidebar, chat and files share header spacing at narrow phone widths", async ({ page }) => {
  const ui = await enter(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    // The chat header's controls are on its first row, with the tab strip under them; that row
    // spaces them as the other two headers do.
    const geometry = async (selector: string) =>
      ui.locator(selector).evaluate((el) => {
        const row = el.querySelector(".mobile-header-row");
        const style = getComputedStyle(el);
        const outer = el.getBoundingClientRect();
        // The chat header measured to 12px under its control row, as the others end.
        const bottom = row ? row.getBoundingClientRect().bottom + 12 : outer.bottom;
        const box = { top: outer.top, left: outer.left, right: outer.right, bottom };
        const controls = [...(row ?? el).querySelectorAll<HTMLButtonElement>("button")];
        const firstControl = controls[0];
        const lastControl = controls.at(-1);
        if (!firstControl || !lastControl) throw new Error("Missing glass header controls");
        const first = firstControl.getBoundingClientRect();
        const last = lastControl.getBoundingClientRect();
        return {
          padding: `${style.paddingTop} ${style.paddingRight}`,
          gap: getComputedStyle(row ?? el).gap,
          height: box.bottom - box.top,
          top: first.top - box.top,
          bottom: box.bottom - first.bottom,
          left: first.left - box.left,
          right: box.right - last.right,
        };
      });
    const main = await geometry(".mobile-header");
    expect(main).toEqual({
      padding: width <= 360 ? "12px 8px" : "12px 12px",
      gap: width <= 360 ? "6px" : "10px",
      height: 68,
      top: 12,
      bottom: 12,
      left: width <= 360 ? 8 : 12,
      right: width <= 360 ? 8 : 12,
    });
    await ui.getByRole("button", { name: "Project files", exact: true }).click();
    expect(await geometry(".mobile-files-header")).toEqual(main);
    await ui.getByRole("button", { name: "Back to chat", exact: true }).click();
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    expect(await geometry(".mobile-sidebar-head")).toEqual(main);
    const head = ui.locator(".mobile-sidebar-head");
    const machine = head.getByRole("combobox", { name: "Machine", exact: true });
    const search = head.getByRole("button", { name: "Search workspace", exact: true });
    await expect(machine).toBeVisible();
    await expect(search).toBeVisible();
    const left = await machine.boundingBox();
    const right = await search.boundingBox();
    if (!left || !right) throw new Error("Missing sidebar controls");
    expect(Math.abs(left.y - right.y)).toBeLessThan(1);
    expect(Math.abs(left.height - right.height)).toBeLessThan(1);
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    expect(left.width).toBeGreaterThan(140);
    expect(right.width).toBeGreaterThanOrEqual(44);
    expect(await head.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`sidebar-spacing-${width}.png`) });
    await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
  }
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(ui.getByRole("dialog", { name: "Machine", exact: true })).toBeVisible();
  await closePickerSheet(ui, "Machine");
  await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
  await expect(ui.getByPlaceholder("Search workspaces and tabs…")).toBeVisible();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
});

test("custom shortcuts persist through the mobile preference bridge and renderer reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let ui = await enter(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
  await choose(ui, "Settings section", "shortcuts");
  await ui
    .getByRole("button", { name: "Edit Search workspaces and tabs shortcuts", exact: true })
    .click();
  const editor = ui.getByRole("dialog", {
    name: "Edit shortcut: Search workspaces and tabs",
    exact: true,
  });
  await editor.getByRole("button", { name: "Type combinations instead" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, first key" }).fill("Ctrl+Alt+S");
  await editor.getByRole("button", { name: "Remove shortcut 2" }).click();
  const bounds = await editor.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error("Shortcut editor has no visible bounds");
  expect(bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath("mobile-shortcut-editor.png") });
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await expect(editor).toHaveCount(0);
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toContainText(
    strokeLabel({ key: "s", modifiers: ["Control", "Alt"] }, await macLabels(ui)),
  );
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await ui.getByRole("textbox", { name: "Message Codex" }).press("Control+Alt+s");
  await expect(ui.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
  ui = await enter(page);
  await ui.getByRole("textbox", { name: "Message Codex" }).press("Control+Alt+s");
  await expect(ui.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
  await ui
    .getByRole("dialog", { name: "Search", exact: true })
    .getByRole("combobox")
    .press("Escape");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await openSettings(ui);
  await choose(ui, "Settings section", "shortcuts");
  await ui.getByRole("button", { name: "Restore all defaults" }).click();
  await expect(ui.getByRole("button", { name: "Restore all defaults" })).toBeDisabled();
});
test("an image on the phone's clipboard can be pasted into the composer", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ui = await enter(page);
  const composer = ui.getByRole("textbox", { name: "Message Codex" });
  await composer.click();
  // Nothing to paste yet: no button for it.
  const paste = ui.getByRole("button", { name: "Paste image", exact: true });
  await expect(paste).toHaveCount(0);
  // A screenshot copied on the phone. The app reads the clipboard itself; the web view cannot.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#2563eb";
    context.fillRect(0, 0, 24, 16);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("No image");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  // Checked again when the app comes back to the foreground, as after copying elsewhere.
  const renderer = await page.locator('iframe[title="Concors workspace"]').elementHandle();
  await (
    await renderer?.contentFrame()
  )?.evaluate(() => window.dispatchEvent(new Event("concors-foreground")));
  await paste.click();
  await expect(ui.getByLabel("Remove Pasted image.png")).toBeVisible();
});
test("the tab strip draws each tab as desktop's tab bar does", async ({ page }) => {
  const ui = await enter(page);
  // The header names the workspace; the strip under it names the tab.
  await expect(switcher(ui)).toHaveText("Concors");
  await expect(currentTab(ui)).toHaveText("Mobile launch 1");
  const chat = stripTab(ui, activeChat);
  // Desktop's status icon while the chat waits on an answer: the logo with its attention badge.
  await expect(chat.locator("[data-agent-status-badge] .bg-destructive")).toBeVisible();
  await expect(chat).toHaveAttribute("aria-description", /^Codex: /);
  // A terminal at a prompt has nothing to show, so it carries the terminal mark.
  const terminal = stripTab(ui, activeTerminal);
  await expect(terminal.locator("[data-agent-status-badge]")).toHaveCount(0);
  await expect(terminal.locator("svg.lucide-terminal")).toBeVisible();
  await expect(terminal).toHaveText("Mobile launch 2");
  // Each tab takes taps across 44pt, with the selected fill drawn inside at the tasks pill's 35pt,
  // and every tab padded alike so a name stays put as the selection moves.
  for (const tab of [chat, terminal])
    expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const fill = await ui.locator(".mobile-tab-strip [data-active-tab]").evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return el.getBoundingClientRect().height - parseFloat(style.top) - parseFloat(style.bottom);
  });
  expect(fill).toBe(35);
  const pill = await ui.locator('[aria-label="Agent tasks"]').boundingBox();
  if (pill) expect(Math.round(pill.height)).toBe(fill);
  const padding = (tab: Locator) => tab.evaluate((el) => getComputedStyle(el).paddingInline);
  expect(await padding(chat)).toBe(await padding(terminal));
  // Neighbouring tabs' tap areas never overlap.
  const [first, second] = await Promise.all([
    box(ui.locator(`.mobile-tab-strip [data-tab-id="${activeChat}"]`)),
    box(ui.locator(`.mobile-tab-strip [data-tab-id="${activeTerminal}"]`)),
  ]);
  expect(first.x + first.width).toBeLessThanOrEqual(second.x);
  const [row, strip] = await Promise.all([
    box(ui.locator(".mobile-header-row")),
    box(tabStrip(ui)),
  ]);
  expect(strip.y - (row.y + row.height)).toBeLessThanOrEqual(8);
  await page.screenshot({ path: "apps/mobile/test-results/mobile-tabs-status.png" });
});
test("the tab strip marks replies in progress, finishes and failures as desktop does", async ({
  page,
}) => {
  await page.goto(`/?${SIDEBAR_TREE_FLAG}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  const tab = (name: string) => tabStrip(ui).locator("[data-pane-choice]", { hasText: name });
  // Open tabs only, in the tab bar's order: closed chats and background terminals stay in the
  // sidebar.
  await expect(tabStrip(ui).locator("[data-pane-choice]")).toHaveText([
    "Mobile launch 1",
    "Mobile launch 2",
    "Release notes",
    "Fix sign-in",
    "Flaky upload test",
    "Roadmap",
  ]);
  // Replying: the badge holds a spinner rather than a dot.
  await expect(tab("Release notes").locator("[data-agent-status-badge]")).toBeVisible();
  await expect(tab("Release notes").locator("[data-agent-status-badge] .rounded-full")).toHaveCount(
    0,
  );
  await expect(tab("Fix sign-in").locator("[data-agent-status-badge] .bg-primary")).toBeVisible();
  await expect(
    tab("Flaky upload test").locator("[data-agent-status-badge] .bg-destructive"),
  ).toBeVisible();
  await expect(tab("Roadmap").locator("[data-agent-status-badge]")).toHaveCount(0);
});
test("the tab strip scrolls sideways with fades and keeps the current tab in view", async ({
  page,
}) => {
  await page.goto(`/?${SIDEBAR_TREE_FLAG}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  const list = ui.locator(".mobile-tab-strip .tab-strip");
  const fade = (edge: string) => ui.locator(`.mobile-tab-strip [data-tab-fade="${edge}"]`);
  await expect(fade("start")).toHaveAttribute("data-visible", "false");
  await expect(fade("end")).toHaveAttribute("data-visible", "true");
  // "+" stays put outside the scrolling part.
  const plus = tabStrip(ui).getByRole("button", { name: "New tab", exact: true });
  const before = await plus.boundingBox();
  // A finger on the strip scrolls it, and opens neither side panel.
  const bounds = await box(list);
  const y = bounds.y + bounds.height / 2;
  const [left, right] = [bounds.x + 20, bounds.x + bounds.width - 20];
  await touchSwipe(page, { x: right, y }, { x: left, y });
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(fade("start")).toHaveAttribute("data-visible", "true");
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-files-open", "false");
  await touchSwipe(page, { x: left, y }, { x: right, y });
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  expect(await plus.boundingBox()).toEqual(before);
  // Choosing the last tab brings it into view, clear of the end fade.
  await tabStrip(ui).locator("[data-pane-choice]", { hasText: "Roadmap" }).click();
  await expect(currentTab(ui)).toHaveText("Roadmap");
  await expect
    .poll(async () => {
      const [tab, strip] = await Promise.all([box(currentTab(ui)), box(list)]);
      return tab.x + tab.width <= strip.x + strip.width + 1;
    })
    .toBe(true);
  // Panel swipes still work from the content area.
  await touchSwipe(page, { x: 30, y: 400 }, { x: 320, y: 400 });
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
});
test("holding a strip tab opens its menu sheet, which a screen reader reaches too", async ({
  page,
}) => {
  const ui = await enter(page);
  const menuItems = () => ui.locator('[role="menu"]').getByRole("menuitem").allTextContents();
  const terminal = stripTab(ui, activeTerminal);
  const held = await box(terminal);
  await hold(page, { x: held.x + held.width / 2, y: held.y + held.height / 2 });
  const sheet = ui.getByRole("dialog", { name: "Mobile launch 2", exact: true });
  await expect(sheet).toBeVisible();
  // The row menu the Tabs sheet had: a terminal has no chat to pin, fork or delete.
  expect(await menuItems()).toEqual(["Close tab…"]);
  await expect(sheet.getByRole("group", { name: "Tab type" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("mobile-tab-long-press.png") });
  // Holding is not a tap: the shown tab stays the chat.
  await expect(currentTab(ui)).toHaveAttribute("data-value", activeChat);
  await ui.locator('[role="menu"]').press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(terminal).toBeFocused();
  // The same sheet without a long-press, from "More actions" beside the tab.
  const more = ui
    .locator(`.mobile-tab-strip [data-tab-id="${activeChat}"]`)
    .getByRole("button", { name: "More actions for Mobile launch 1", exact: true });
  await expect(more).toHaveAttribute("aria-haspopup", "dialog");
  await more.press("Enter");
  await expect(ui.getByRole("dialog", { name: "Mobile launch 1", exact: true })).toBeVisible();
  await ui.locator('[role="menu"]').press("Escape");
  // And from the keyboard's context-menu key on the tab itself.
  await stripTab(ui, activeChat).press("Shift+F10");
  await expect(ui.getByRole("dialog", { name: "Mobile launch 1", exact: true })).toBeVisible();
});
test("the workspace switcher lists open workspaces and returns to each one's last tab", async ({
  page,
}) => {
  await page.goto(`/?${SIDEBAR_TREE_FLAG}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await choose(ui, "Tabs", activeTerminal);
  await switcher(ui).click();
  const sheet = ui.getByRole("dialog", { name: "Workspaces", exact: true });
  const rows = sheet.locator("[data-workspace-choice]");
  // Two workspaces share a name, so each shows its parent folder, as the sidebar does.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("forks");
  await expect(rows.first().locator(".mobile-pane-selected")).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-current", "page");
  // The other workspace's chat finished, so its icon carries the sidebar's dot.
  await expect(rows.nth(1).locator('[data-workspace-attention="done"]')).toBeVisible();
  await expect(rows.first().locator("[data-project-icon]")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("mobile-workspace-switcher.png") });
  await rows.nth(1).click();
  await expect(sheet).toHaveCount(0);
  await expect(currentTab(ui)).toHaveText("Try the new parser");
  // Back again, on the tab it was last on.
  await switcher(ui).click();
  await rows.first().click();
  await expect(currentTab(ui)).toHaveAttribute("data-value", activeTerminal);
  // "Open workspace…" closes this sheet and opens the sidebar's "+" sheet on its own.
  await switcher(ui).click();
  await sheet.getByRole("button", { name: "Open workspace…", exact: true }).click();
  const open = ui.getByRole("dialog", { name: "Open workspace", exact: true });
  await expect(open).toBeVisible();
  await expect(open.getByRole("button", { name: "Open folder…", exact: true })).toBeVisible();
  await expect(ui.getByRole("dialog")).toHaveCount(1);
});
test("schedules and pull requests keep their page title in the header, with no tab strip", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.locator("#mobile-sidebar-toggle").click();
  await ui
    .getByRole("dialog", { name: "Workspace sidebar" })
    .getByRole("button", { name: /^Schedules(,|$)/ })
    .first()
    .click();
  await expect(ui.getByRole("heading", { level: 1, name: "Schedules", exact: true })).toBeVisible();
  await expect(ui.locator(".mobile-tab-strip")).toHaveCount(0);
  await expect(switcher(ui)).toHaveCount(0);
});
test("the tab strip slides away while typing and returns when the keyboard closes", async ({
  page,
}) => {
  const ui = await enter(page);
  const strip = ui.locator(".mobile-tab-strip");
  const stripHeight = () =>
    ui
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--mobile-strip-height").trim());
  const fade = () =>
    ui.locator(".mobile-header").evaluate((el) => getComputedStyle(el, "::before").height);
  await expect(strip).toBeVisible();
  await expect.poll(stripHeight).toBe("44px");
  const open = await fade();
  // Focusing the composer stands for the keyboard opening.
  await ui.getByRole("textbox", { name: "Message Codex" }).click();
  await expect(ui.locator(".mobile-composer")).toHaveAttribute("data-expanded", "true");
  await expect(strip).toBeHidden();
  await expect.poll(stripHeight).toBe("0px");
  // The header's controls stay, and its fade shrinks by the strip's height.
  for (const name of ["Open sidebar", "Project files"])
    await expect(ui.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(ui.getByRole("button", { name: /^Workspace: / })).toBeVisible();
  await expect.poll(fade).toBe(`${parseFloat(open) - 44}px`);
  await page.screenshot({ path: test.info().outputPath("mobile-typing-strip-hidden.png") });
  // The keyboard closing brings it back.
  await ui.getByRole("log", { name: "Chat timeline" }).click({ position: { x: 200, y: 300 } });
  await expect(ui.locator(".mobile-composer")).toHaveAttribute("data-expanded", "false");
  await expect(strip).toBeVisible();
  await expect.poll(stripHeight).toBe("44px");
  await expect.poll(fade).toBe(open);
});
test("queued messages show one at a time with their place, never a row peeking out", async ({
  page,
}) => {
  const ui = await enter(page);
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  const list = ui.locator(".mobile-queue-list");
  const rows = list.locator(".mobile-queue-row");
  for (const count of [1, 2, 3]) {
    await input.fill(`Queued follow-up ${count}`);
    await ui.getByRole("button", { name: "Queue message", exact: true }).click();
    await expect(rows).toHaveCount(count);
    // Exactly one whole row shows: the list is as tall as a row.
    const [shown, row] = await Promise.all([box(list), box(rows.first())]);
    expect(Math.round(shown.height)).toBe(Math.round(row.height));
    if (count === 1) await expect(rows.first()).not.toContainText(/of \d/);
    else await expect(rows.first()).toContainText(`1 of ${count}`);
  }
  // Scrolling the list moves one whole row: the next message, never part of one.
  await list.evaluate((el) => el.scrollBy({ top: 30, behavior: "instant" }));
  await expect
    .poll(async () => {
      const [shown, next] = await Promise.all([box(list), box(rows.nth(1))]);
      return Math.round(next.y - shown.y);
    })
    .toBe(0);
  await expect(rows.nth(1)).toContainText("2 of 3");
});
test("pages opened from a chat start below the header, and the chat scrolls under it again", async ({
  page,
}) => {
  const ui = await enter(page);
  const header = ui.locator(".mobile-header");
  const openFromSidebar = async (name: string) => {
    await ui.locator("#mobile-sidebar-toggle").click();
    await ui
      .getByRole("dialog", { name: "Workspace sidebar" })
      .getByRole("button", { name: new RegExp(`^${name}(,|$)`) })
      .first()
      .click();
  };
  for (const [name, summary] of [
    ["Pull requests", /^Pull requests in your workspaces/],
    ["Schedules", /^Run your agents on a cadence/],
  ] as const) {
    await openFromSidebar(name);
    // The header names the page, so the page does not name it a second time.
    await expect(ui.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await expect(ui.getByRole("heading", { level: 2, name, exact: true })).toHaveCount(0);
    const content = ui.locator(".mobile-pane").getByText(summary);
    await expect(content).toBeVisible();
    await expect
      .poll(async () => {
        const [top, bar] = await Promise.all([content.boundingBox(), header.boundingBox()]);
        return top && bar ? top.y - (bar.y + bar.height) : null;
      })
      .toBeGreaterThanOrEqual(0);
  }
  await ui.locator("#mobile-sidebar-toggle").click();
  await tabRow(ui, "Mobile launch").click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await expect(ui.locator(".mobile-pane")).toHaveCSS("padding-top", "0px");
});
test("the demo's Pull requests and Schedules pages show sample work, read-only for GitHub", async ({
  page,
}) => {
  const ui = await enter(page);
  const open = async (name: string) => {
    await ui.locator("#mobile-sidebar-toggle").click();
    await ui
      .getByRole("dialog", { name: "Workspace sidebar" })
      .getByRole("button", { name })
      .first()
      .click();
  };
  await open("Pull requests");
  await expect(ui.getByText(/Update the daemon/)).toHaveCount(0);
  const row = ui.getByText("Keep the composer at the bottom of the screen");
  await expect(row).toBeVisible();
  await ui.getByRole("tab", { name: /Merged/ }).click();
  await expect(ui.getByText("Reopen the last tab at launch")).toBeVisible();
  await expect(row).toHaveCount(0);
  await ui.getByRole("tab", { name: /Open/ }).click();
  await row.click();
  await expect(ui.getByText("Everything in this preview is simulated.")).toBeVisible();
  await expect(ui.getByRole("button", { name: /^Merge/ })).toBeDisabled();
  await expect(ui.getByRole("button", { name: /^Close/ })).toHaveCount(0);
  await open("Schedules");
  await expect(ui.getByText(/Update the daemon/)).toHaveCount(0);
  await expect(ui.getByText("Morning review")).toBeVisible();
  await expect(ui.getByText("Dependency check")).toBeVisible();
});
test("the app reopens the tab last opened on this machine", async ({ page }) => {
  let ui = await enter(page);
  const tabs = currentTab(ui);
  await expect(tabs).toHaveAttribute("data-value", activeChat);
  await choose(ui, "Tabs", activeTerminal);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  ui = workspace(page);
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
  await expect(tabs).toHaveAttribute("data-value", activeTerminal);
  // Picking again moves what the next launch opens.
  await choose(ui, "Tabs", activeChat);
  await enter(page);
  await expect(tabs).toHaveAttribute("data-value", activeChat);
});
test("the sidebar lists each workspace's tabs under it, as desktop does", async ({ page }) => {
  const enterTree = async () => {
    await page.goto(`/?${SIDEBAR_TREE_FLAG}`);
    await page.getByRole("button", { name: "Explore demo" }).click();
    const ui = workspace(page);
    await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    return ui;
  };
  let ui = await enterTree();
  const sidebar = ui.getByRole("dialog", { name: "Workspace sidebar" });
  const row = (id: string) => sidebar.locator(`[data-sidebar-row$="${id}"]`);
  const state = (id: string) => row(id).locator("[data-row-state]");
  // Two workspaces with one name are told apart by their parent folders.
  const workspaces = sidebar.locator("[data-workspace-id]");
  await expect(workspaces).toHaveCount(2);
  await expect(workspaces.nth(0)).toContainText(/Concors\s*alex/);
  await expect(workspaces.nth(1)).toContainText(/Concors\s*forks/);
  // Pins first, then open tabs in the tab bar's order, then what closed, newest first.
  const first = sidebar.getByRole("list", { name: "Concors tabs" }).first();
  await expect(first.getByRole("listitem")).toHaveText([
    /^Roadmap/,
    /^Mobile launch/,
    /Release notes/,
    /^Fix sign-in/,
    /^Flaky upload test/,
    /^pnpm dev/,
    /^Old onboarding copy/,
  ]);
  await expect(row(treeIds.pinnedTab).getByLabel("Pinned")).toBeVisible();
  await expect(row(treeIds.closed).locator("[data-agent-closed]")).toBeVisible();
  // Each status as desktop shows it: a spinner while replying, red for a question or a failure,
  // the accent once finished, grey for a terminal running with its tab closed.
  await expect(state(treeIds.workingTab)).toHaveAttribute("data-row-state", "working");
  await expect(state(ids.tab)).toHaveAttribute("data-row-state", "attention");
  await expect(state(treeIds.failedTab)).toHaveAttribute("data-row-state", "attention");
  await expect(state(treeIds.doneTab)).toHaveAttribute("data-row-state", "done");
  await expect(state(treeIds.background)).toHaveAttribute("data-row-state", "running");
  // Rows and their menus are 44pt targets.
  for (const target of [
    workspaces.nth(0),
    row(treeIds.doneTab).locator("> button").first(),
    row(treeIds.doneTab).getByRole("button", { name: "Actions for Fix sign-in" }),
  ])
    expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  // Tapping a workspace folds it alone, keeps the sidebar open, and moves its dot to the folder.
  const fork = workspaces.nth(1);
  await expect(fork).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator("[data-workspace-attention]")).toHaveCount(0);
  await fork.click();
  await expect(fork).toHaveAttribute("aria-expanded", "false");
  await expect(workspaces.nth(0)).toHaveAttribute("aria-expanded", "true");
  await expect(row(treeIds.forkTab)).toBeHidden();
  await expect(sidebar.locator('[data-workspace-attention="done"]')).toBeVisible();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  // Folded stays folded, as desktop remembers it.
  ui = await enterTree();
  await expect(fork).toHaveAttribute("aria-expanded", "false");
  await fork.click();
  await expect(row(treeIds.forkTab)).toBeVisible();

  // Tapping a tab opens it, in its own workspace, and closes the sidebar.
  await row(treeIds.forkTab).locator("> button").first().click();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(currentTab(ui)).toContainText("Try the new parser");
  // A closed chat opens again from its row.
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await row(treeIds.closed).locator("> button").first().click();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await expect(ui.getByRole("log", { name: "Chat timeline" })).toContainText(
    "Old onboarding copy: can you take this on?",
  );
});
test("workspace rows show their fold chevron, and their menu starts a tab there", async ({
  page,
}) => {
  await page.goto(`/?${SIDEBAR_TREE_FLAG}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const sidebar = ui.getByRole("dialog", { name: "Workspace sidebar" });
  const rows = sidebar.locator("li:has(> button[data-workspace-id])");
  const fork = rows.nth(1);
  const chevron = fork.locator("[data-workspace-chevron]");
  // Desktop's hover chevron, always shown at the row's end: down while open, right once folded.
  // The workspace keeps its icon, which carries the folded workspace's dot.
  await expect(sidebar.locator('[data-workspace-chevron="expanded"]')).toHaveCount(2);
  await expect(fork.locator("[data-project-icon]")).toBeVisible();
  const [icon, mark] = await Promise.all([
    fork.locator("[data-project-icon]").boundingBox(),
    chevron.boundingBox(),
  ]);
  expect(mark && icon && mark.x > icon.x + 100).toBe(true);
  await fork.locator("[data-workspace-id]").click();
  await expect(chevron).toHaveAttribute("data-workspace-chevron", "collapsed");
  await expect(fork.locator('[data-workspace-attention="done"]')).toBeVisible();
  await fork.locator("[data-workspace-id]").click();
  await expect(chevron).toHaveAttribute("data-workspace-chevron", "expanded");
  await expect(fork.locator("[data-workspace-attention]")).toHaveCount(0);

  // "New tab" leads the workspace's menu and opens the New tab sheet in that workspace.
  await fork.getByRole("button", { name: "Actions for Concors", exact: true }).click();
  const menu = ui.getByRole("menu", { name: "Concors" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "New tab",
    "Rename workspace",
    "Close workspace…",
  ]);
  await menu.getByRole("menuitem", { name: "New tab" }).click();
  await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "false");
  await ui.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(
    sidebar.getByRole("list", { name: "Concors tabs" }).nth(1).getByRole("listitem"),
  ).toHaveCount(2);
});
test("the New tab sheet lists a saved terminal profile after the built-in ones", async ({
  page,
}) => {
  await page.goto(`/?${TERMINAL_PROFILE_FLAG}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = workspace(page);
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
  await newTab(ui);
  const sheet = ui.getByRole("dialog", { name: "New tab", exact: true });
  await expectNewTabGroups(sheet, ["Terminal", "Claude Code", "Codex", "OpenCode", "Dev server"]);
  await sheet.getByRole("button", { name: "Dev server", exact: true }).click();
  await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
});
