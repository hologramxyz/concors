import { test, expect, signedIn } from "./signed-in.ts";
import type { Page } from "@playwright/test";
import { chooseProvider } from "./support/agents.ts";
const KEY = "concors.shortcuts.v1";
const search = "Search workspaces, agents and tabs";
async function openSettings(page: Page) {
  await signedIn(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open workspace menu", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Control+Shift+Slash");
  await expect(page.getByRole("heading", { name: "Shortcuts", exact: true })).toBeVisible();
}
async function edit(page: Page, label: string) {
  await page.getByRole("button", { name: `Edit ${label} shortcuts`, exact: true }).click();
  return page.getByRole("dialog", { name: `Edit shortcut: ${label}`, exact: true });
}
async function record(page: Page, name: string, keys: string) {
  await page.getByRole("textbox", { name, exact: true }).focus();
  await page.keyboard.press(keys);
}

test("recorded shortcuts replace aliases, update hints, persist across reloads and windows, and can be disabled", async ({
  page,
  context,
}) => {
  await openSettings(page);
  const editor = await edit(page, search);
  await record(page, "Shortcut 1, first key", "Control+Alt+s");
  // Recording a command does not open the app's search or sequence popup underneath it.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await editor.getByRole("button", { name: "Remove shortcut 2", exact: true }).click();
  await editor.getByRole("button", { name: "Save shortcuts", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Ctrl+Alt+S");
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Search", exact: true }).hover();
  await expect(
    page.getByRole("tooltip", { name: "Search (Ctrl+Alt+S)", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+Alt+s");
  const searchDialog = page.getByRole("dialog", { name: "Search", exact: true });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Alt+s");
  await expect(searchDialog).toBeVisible();
  await page.keyboard.press("Escape");
  const second = await context.newPage();
  await signedIn(second);
  await second.goto("/");
  await expect(second.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+Slash");
  const disable = await edit(page, search);
  await disable.getByRole("button", { name: "Remove shortcut 1" }).click();
  await disable.getByRole("button", { name: "Save shortcuts" }).click();
  await expect
    .poll(() => second.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").search, KEY))
    .toEqual([]);
  await second.keyboard.press("Control+Alt+s");
  await expect(second.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore all defaults" }).click();
  await expect(page.getByRole("button", { name: "Restore all defaults" })).toBeDisabled();
  await second.keyboard.press("Control+Shift+k");
  await expect(second.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
  await second.close();
});

test("custom sequences split from a terminal and run from an Agent input without leaking keystrokes", async ({
  page,
}) => {
  await openSettings(page);
  const editor = await edit(page, "New pane beside current");
  await record(page, "Shortcut 1, first key", "Control+Alt+p");
  await record(page, "Shortcut 1, second key", "Enter");
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.keyboard.press("Control+Shift+n");
  const terminals = page.locator(".concors-terminal textarea").filter({ visible: true });
  await expect(terminals).toHaveCount(1);
  await terminals.first().focus();
  await page.keyboard.press("Control+Alt+p");
  await expect(page.getByRole("dialog", { name: "Shortcut actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(terminals.first()).toBeFocused();
  await page.keyboard.press("Control+Alt+p");
  await page.keyboard.press("Enter");
  await expect(terminals).toHaveCount(2);
  await expect(terminals.last()).toBeFocused();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
  await chooseProvider(page);
  const chat = page.getByRole("textbox", { name: "Message Codex", exact: true });
  await expect(chat).toBeEnabled();
  await chat.fill("Keep this draft");
  await page.keyboard.press("Control+Alt+p");
  await page.keyboard.press("Enter");
  // The new Agent pane waits for its provider, then hands focus to its composer.
  await chooseProvider(page);
  await expect(chat).toHaveCount(2);
  await expect(chat.last()).toBeFocused();
  // Ctrl+Shift+Arrow selects words in the composer rather than moving to another pane.
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await expect(chat.last()).toBeFocused();
  await expect(chat.first()).toHaveValue("Keep this draft");
});

test("conflicts require deliberate reassignment and defaults can be restored per command", async ({
  page,
}) => {
  await openSettings(page);
  const editor = await edit(page, "Settings");
  await record(page, "Shortcut 1, first key", "Control+Shift+k");
  await expect(editor).toContainText(`Already assigned:`);
  await expect(editor.getByRole("button", { name: "Save shortcuts" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("shortcut-conflict-editor.png") });
  await editor.getByRole("checkbox", { name: /Reassign these shortcuts/ }).check();
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").search.length, KEY),
    )
    .toBe(1);
  const restore = await edit(page, "Settings");
  await restore.getByRole("button", { name: "Use defaults" }).click();
  await restore.getByRole("button", { name: "Save shortcuts" }).click();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").settings, KEY))
    .toBeUndefined();
  const restoreSearch = await edit(page, search);
  await restoreSearch.getByRole("button", { name: "Use defaults" }).click();
  await restoreSearch.getByRole("button", { name: "Save shortcuts" }).click();
  await expect(page.getByRole("button", { name: "Restore all defaults" })).toBeDisabled();
});

test("manual input supports modifiers and function keys, and invalid recordings cannot be saved", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole("textbox", { name: "Filter shortcuts" }).fill("Rename tab");
  const editor = await edit(page, "Rename tab");
  await record(page, "Shortcut 1, first key", "a");
  await expect(editor).toContainText("Start with Control");
  await expect(editor.getByRole("button", { name: "Save shortcuts" })).toBeDisabled();
  await editor.getByRole("button", { name: "Type combinations instead" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, first key" }).fill("Alt+F6");
  await editor.getByRole("button", { name: "Add shortcut", exact: true }).click();
  await editor.getByRole("textbox", { name: "Shortcut 2, first key" }).fill("Control+Meta+R");
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await expect(page.getByRole("main")).toContainText("Alt+F6");
  await expect(page.getByRole("main")).toContainText("Ctrl+Win+R");
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.keyboard.press("Control+Shift+n");
  const tab = page.getByRole("button", { name: "Tab 1", exact: true });
  await expect(tab).toBeVisible();
  // A new tab moves focus into its pane once the pane's input arrives. Let that settle, as it has
  // long before a person could reach the tab, or it takes focus back from the tab below.
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-pane-id] textarea")))
    .toBe(true);
  await tab.focus();
  await page.keyboard.press("F2");
  await expect(page.getByRole("textbox", { name: "Tab name" })).toHaveCount(0);
  await page.keyboard.press("Alt+F6");
  await expect(page.getByRole("textbox", { name: "Tab name" })).toBeFocused();
  await page.getByRole("textbox", { name: "Tab name" }).fill("Custom binding");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Custom binding", exact: true })).toBeVisible();
});

test("a failed preference save keeps the previous bindings and the draft available", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error("Shortcut storage is unavailable");
      write.call(this, name, value);
    };
  }, KEY);
  await openSettings(page);
  const editor = await edit(page, "Settings");
  await record(page, "Shortcut 1, first key", "Control+Alt+s");
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await expect(editor.getByRole("alert")).toContainText("Shortcut storage is unavailable");
  await expect(editor.getByRole("textbox", { name: "Shortcut 1, first key" })).toHaveValue(
    "Ctrl+Alt+S",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Ctrl+Shift+,");
});

test("a configured Tab continuation runs its command instead of moving popup focus", async ({
  page,
}) => {
  await openSettings(page);
  const editor = await edit(page, search);
  await editor.getByRole("button", { name: "Type combinations instead" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, first key" }).fill("Ctrl+Alt+S");
  await editor.getByRole("button", { name: "Remove shortcut 2" }).click();
  await editor.getByRole("button", { name: "Add second step" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, second key" }).fill("Tab");
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.keyboard.press("Control+Alt+s");
  await expect(page.getByRole("dialog", { name: "Shortcut actions" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog", { name: "Search", exact: true })).toBeVisible();
});

test("tab-scoped sequences rename the focused tab even when another tab is selected", async ({
  page,
}) => {
  await openSettings(page);
  const editor = await edit(page, "Rename tab");
  await editor.getByRole("button", { name: "Type combinations instead" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, first key" }).fill("F6");
  await editor.getByRole("button", { name: "Add second step" }).click();
  await editor.getByRole("textbox", { name: "Shortcut 1, second key" }).fill("R");
  await editor.getByRole("button", { name: "Save shortcuts" }).click();
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.keyboard.press("Control+Shift+n");
  const first = page.getByRole("button", { name: "Tab 1", exact: true });
  await expect(first).toBeVisible();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
  const second = page.getByRole("button", { name: "Tab 2", exact: true });
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await first.focus();
  await page.keyboard.press("F6");
  await page.keyboard.press("r");
  const name = page.getByRole("textbox", { name: "Tab name", exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Tab 1");
  await name.fill("Focused tab");
  await name.press("Enter");
  await expect(page.getByRole("button", { name: "Focused tab", exact: true })).toBeVisible();
  await expect(second).toHaveAttribute("aria-pressed", "true");
});
