import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";

test("workspace shortcuts create, search, split and close the active pane without leaking into terminals", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-shortcuts-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Add project", exact: true }).first(),
    ).toBeEnabled();
    await page.keyboard.press("Control+Shift+n");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Project name", { exact: true }).fill("Keyboard project");
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
    ).toBe(true);
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Keyboard project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+t");
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    await expect(panes).toHaveCount(1);
    await expect(page.getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");
    await panes.first().locator("textarea").focus();
    // Ctrl+K stays in the terminal; the app variant opens search.
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder("Type a command or search…").fill("Keyboard shortcuts");
    await page.getByRole("option", { name: /Keyboard shortcuts/ }).click();
    await expect(
      page.getByRole("heading", { name: "Keyboard shortcuts", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Ctrl+Shift+W");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await panes.first().locator("textarea").focus();
    await page.keyboard.press("Control+Shift+d");
    await expect(panes).toHaveCount(2);
    await expect(page.getByRole("separator", { name: /Resize/ })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    const newPane = panes.last();
    await expect(newPane.locator("textarea")).toBeFocused();
    await page.keyboard.press("Control+Shift+e");
    await expect(panes).toHaveCount(3);
    await expect(page.getByRole("separator", { name: /Resize/ })).toHaveCount(2);
    await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toHaveCount(1);
    await expect(panes.last().locator("textarea")).toBeFocused();
    await expect(panes.last().getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");
    const closedId = await page.evaluate(() =>
      document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
    );
    // Closing a pane deliberately leaves its PTY alive; end this fixture first.
    await page.keyboard.type("exit");
    await page.keyboard.press("Enter");
    await expect(panes.last().getByRole("button", { name: "Start new session" })).toBeVisible();
    await page.keyboard.press("Control+Shift+w");
    await expect(panes).toHaveCount(2);
    await expect(page.locator(`[data-pane-id="${closedId}"]`)).toHaveCount(0);
    await page.keyboard.press("Control+Shift+p");
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
        .getByRole("button", { name: /Running in terminal.*Codex/ }),
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
        .getByRole("button", { name: /Running in terminal.*Codex/ }),
    ).toHaveCount(0);
    await panes.first().focus();
    await page.keyboard.press("Control+Shift+x");
    await expect(panes).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Codex", exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+Shift+k");
    await page.getByPlaceholder("Type a command or search…").fill("Keyboard project");
    await page.getByRole("option", { name: "Keyboard project", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Keyboard project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+k");
    await page.getByPlaceholder("Type a command or search…").fill("New tab");
    await page.getByRole("option", { name: /New tab/ }).click();
    await expect(page.getByRole("menuitem", { name: "Terminal", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
      page.getByRole("button", { name: "Add project", exact: true }).first(),
    ).toBeEnabled();
    await page.keyboard.press("Control+Shift+n");
    await page.getByLabel("Project name", { exact: true }).fill("Mac keyboard project");
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Mac keyboard project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+Shift+t");
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const panes = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(panes).toHaveCount(1);
    await expect(page.getByRole("button", { name: "New tab", exact: true })).toHaveAttribute(
      "title",
      "New tab (Control+Shift+T)",
    );
    await expect(page.getByRole("button", { name: "Pane actions", exact: true })).toBeEnabled();
    await panes.first().focus();
    await page.keyboard.press("Control+Shift+d");
    await expect(panes).toHaveCount(2);
    const newPaneId = await panes.last().getAttribute("data-pane-id");
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(newPaneId);
    await page.keyboard.press("Control+Shift+w");
    await expect(panes).toHaveCount(1);
    expect(page.isClosed()).toBe(false);
    await page.keyboard.press("Control+Shift+x");
    await expect(panes).toHaveCount(0);
    await page.keyboard.press("Control+Shift+Slash");
    await expect(page.getByRole("dialog")).toContainText(
      "physical Control (⌃) key, not Command (⌘)",
    );
    await expect(page.getByRole("dialog")).toContainText("Control+Shift+W");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
