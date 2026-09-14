import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { BINDINGS } from "../apps/desktop/src/shortcuts/bindings.ts";
import { bindingLabel, defaultKeymap } from "../apps/desktop/src/shortcuts/keymap.ts";

test("workspace shortcuts create, search, split and close the active pane without leaking into terminals", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-shortcuts-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Open workspace menu", exact: true }).first(),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Shortcuts", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Shortcuts", exact: true })
      .click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Shortcuts", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+n");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".concors-terminal .xterm").filter({ visible: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
    await page.getByRole("button", { name: "Paste a URL", exact: true }).click();
    await page.getByLabel("Repository URL or local path").focus();
    // Workspace actions must not escape a form dialog.
    await page.keyboard.press("Control+Shift+t");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const event = new KeyboardEvent("keydown", {
          key: "w",
          code: "KeyW",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.activeElement?.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Let the closing dialog restore focus before moving it into the terminal.
    await expect(
      page.getByRole("button", { name: "Open workspace menu", exact: true }),
    ).toBeFocused();
    await page.locator(".concors-terminal textarea").filter({ visible: true }).focus();
    await page.keyboard.type(`cd '${directory}'`);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: basename(directory), exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+t");
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    const tab = page.getByLabel("Project tabs", { exact: true }).getByRole("button", {
      name: "Tab 2",
      exact: true,
    });
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    await expect(panes).toHaveCount(1);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
    await panes.first().locator("textarea").focus();
    // Ctrl+K stays in the terminal; the app variant opens search.
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder("Search workspaces, agents, tabs…").fill("Shortcuts");
    await page.getByRole("option", { name: /Shortcuts/ }).click();
    await expect(page.getByRole("heading", { name: "Shortcuts", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Ctrl+Shift+P → Backspace");
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await panes.first().locator("textarea").focus();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("ArrowRight");
    await expect(panes).toHaveCount(2);
    await expect(page.getByRole("separator", { name: /Resize/ })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    const newPane = panes.last();
    await expect(newPane.locator("textarea")).toBeFocused();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("ArrowDown");
    await expect(panes).toHaveCount(3);
    await expect(page.getByRole("separator", { name: /Resize/ })).toHaveCount(2);
    await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toHaveCount(1);
    await expect(panes.last().locator("textarea")).toBeFocused();
    await expect(
      panes.last().getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("CODEX_TERMINAL_READY");
    const closedId = await page.evaluate(() =>
      document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
    );
    // Closing a pane deliberately leaves its PTY alive; end this fixture first.
    await page.keyboard.type("exit");
    await page.keyboard.press("Enter");
    await expect(panes.last().getByRole("button", { name: "Start new session" })).toBeVisible();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Backspace");
    await expect(panes).toHaveCount(2);
    await expect(page.locator(`[data-pane-id="${closedId}"]`)).toHaveCount(0);
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Enter");
    await expect(panes).toHaveCount(3);
    // Repeated keydown events must not create additional panes.
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          code: "KeyP",
          ctrlKey: true,
          shiftKey: true,
          repeat: true,
          bubbles: true,
        }),
      ),
    );
    await expect(panes).toHaveCount(3);
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("region", { name: "Agents", exact: true })
        .getByRole("button", { name: /Open in terminal.*Codex/ }),
    ).toHaveCount(3);
    // The daemon is shared by acceptance tests; stop our fixture before detaching its pane.
    for (const pane of await panes.all()) {
      await pane.locator("textarea").focus();
      await page.keyboard.type("exit");
      await page.keyboard.press("Enter");
      await expect(pane.getByRole("button", { name: "Start new session" })).toBeVisible();
    }
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("region", { name: "Agents", exact: true })
        .getByRole("button", { name: /Open in terminal.*Codex/ }),
    ).toHaveCount(0);
    await panes.first().focus();
    await page.keyboard.press("Control+Shift+t");
    await page.keyboard.press("Backspace");
    await expect(panes).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    await page.keyboard.press("Control+Shift+k");
    await page.getByPlaceholder("Search workspaces, agents, tabs…").fill(basename(directory));
    await page
      .locator('[data-search-result="workspace"]')
      .filter({ hasText: basename(directory) })
      .click();
    await expect(
      page.getByRole("heading", { name: basename(directory), exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+k");
    await page.getByPlaceholder("Search workspaces, agents, tabs…").fill("New tab");
    await page.getByRole("option", { name: /New tab/ }).click();
    await expect(page.getByRole("menuitem", { name: "Terminal", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shortcuts have a dedicated settings page and the account menu only shows identity and account actions", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");
  const account = page.getByRole("button", { name: /^Account:/ });
  await account.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
  await expect(menu.getByText("E2E User", { exact: true })).toBeVisible();
  await expect(menu.getByText("e2e@example.com", { exact: true })).toBeVisible();
  await expect(menu.getByText("Personal organization", { exact: true })).toHaveCount(0);
  await expect(menu.locator('[data-slot="dropdown-menu-label"]')).toHaveText(
    "E2E Usere2e@example.com",
  );
  await page.screenshot({ path: "test-results/account-menu-clean.png" });
  await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const settings = page.getByRole("navigation", { name: "Settings" });
  const shortcuts = settings
    .getByRole("region", { name: "Personal" })
    .getByRole("button", { name: "Shortcuts", exact: true });
  await shortcuts.focus();
  await page.keyboard.press("Enter");
  await expect(shortcuts).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Workspace", "Tabs", "Panes"]);
  await expect(main.locator("dt")).toHaveCount(BINDINGS.length);
  for (const binding of BINDINGS) {
    const label = main.getByText(binding.label, { exact: true });
    await expect(label).toHaveCount(1);
    await expect(label.locator("..").locator("kbd")).toHaveText(
      defaultKeymap(false)[binding.id].map((shortcut) => bindingLabel(shortcut, false)),
    );
  }
  await page.screenshot({ path: "test-results/settings-shortcuts-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 600, height: 850 });
  await expect.poll(() => main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/settings-shortcuts-narrow-dark.png" });

  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.keyboard.press("Control+Shift+Slash");
  await expect(shortcuts).toHaveAttribute("aria-current", "page");
  await settings.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(account).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await page.keyboard.press("Control+Shift+Slash");
  await expect(shortcuts).toHaveAttribute("aria-current", "page");
  await settings.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("Mac workspace shortcuts use physical Control and display matching hints", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mac-shortcuts-"));
  try {
    // Exercise the Mac branch in browser CI; this does not simulate native macOS accelerators.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }),
    );
    await signedIn(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Open workspace menu", exact: true }).first(),
    ).toBeEnabled();
    await page.keyboard.press("Control+Shift+n");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".concors-terminal textarea").filter({ visible: true }).focus();
    await page.keyboard.type(`cd '${directory}'`);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: basename(directory), exact: true }),
    ).toBeVisible();
    const panes = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(panes).toHaveCount(1);
    await expect(page.getByRole("button", { name: "New tab", exact: true })).toHaveAttribute(
      "title",
      "New tab (Control+Shift+T → Enter)",
    );
    await expect(page.getByRole("button", { name: "Pane actions", exact: true })).toBeEnabled();
    await panes.first().focus();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("ArrowRight");
    await expect(panes).toHaveCount(2);
    await expect
      .poll(() => panes.last().evaluate((pane) => pane.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Backspace");
    await expect(panes).toHaveCount(1);
    expect(page.isClosed()).toBe(false);
    await page.keyboard.press("Control+Shift+t");
    await page.keyboard.press("Backspace");
    await expect(panes).toHaveCount(0);
    await page.keyboard.press("Control+Shift+Slash");
    await expect(page.getByRole("main")).toContainText("physical Control (⌃) key, not Command (⌘)");
    await expect(page.getByRole("main")).toContainText("Control+Shift+P → Backspace");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
