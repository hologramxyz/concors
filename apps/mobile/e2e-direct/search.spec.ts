import { test, expect } from "@playwright/test";
import { searchWorkspace } from "../../../e2e/support/search-workspace.ts";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

test("mobile Search is a sidebar-preserving drawer with real pane navigation and working commands", async ({
  page,
}) => {
  const fixture = await searchWorkspace(mobileDesktopSocket);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const before = fixture.project().tabs.map((tab) => ({
      ...tab,
      nodes: tab.nodes.map((node) => (node.kind === "pane" ? { ...node, sessionId: null } : node)),
    }));
    const desktopSelection = { ...fixture.snapshot().selection };
    await page.goto(
      `/session?machineId=${fixture.snapshot().machineId}&projectId=${fixture.projectId}&tabId=${fixture.otherTabId}&paneId=${fixture.otherPaneId}`,
    );
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const shell = ui.locator(".mobile-shell");
    const open = async () => {
      await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
    };
    await open();
    const dialog = ui.getByRole("dialog", { name: "Search", exact: true });
    const input = dialog.getByRole("combobox");
    await expect(dialog).toHaveAttribute("data-mobile-drawer", "true");
    await expect(shell).toHaveAttribute("data-sidebar-open", "true");
    await expect(input).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("mobile-search.png") });
    await expect(dialog).toContainText("not messages or file contents");
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await input.fill("backend");
    await dialog.getByRole("button", { name: "Workspaces", exact: true }).click();
    await expect(dialog.locator('[data-search-result="workspace"]')).toHaveCount(1);
    await expect(dialog.locator('[data-search-result="workspace"]')).toHaveAttribute(
      "data-search-project-id",
      fixture.otherProjectId,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(shell).toHaveAttribute("data-sidebar-open", "true");
    const searchButton = ui.getByRole("button", { name: "Search workspace", exact: true });
    await expect(searchButton).toBeFocused();
    await searchButton.click();
    await expect(input).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await input.fill("build terminal");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await input.press("Enter");
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    const picker = ui.getByRole("combobox", { name: "Tabs", exact: true });
    await expect(picker).toHaveAttribute("data-value", `${fixture.tabId}:${fixture.terminalId}`);
    await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
    await open();
    await input.fill("Codex");
    await dialog
      .locator(`[data-search-result="pane"][data-search-pane-id="${fixture.chatId}"]`)
      .click();
    await expect(picker).toHaveAttribute("data-value", `${fixture.tabId}:${fixture.chatId}`);
    const chat = ui.getByRole("textbox", { name: "Message Codex" });
    await chat.fill("Search should keep this draft");
    await open();
    await input.fill("release notes");
    await input.press("Enter");
    await expect(picker).toHaveAttribute(
      "data-value",
      `${fixture.otherTabId}:${fixture.otherPaneId}`,
    );
    await open();
    await input.fill("Codex");
    await input.press("Enter");
    await expect(chat).toHaveValue("Search should keep this draft");
    expect(fixture.snapshot().selection).toEqual(desktopSelection);
    expect(
      fixture.project().tabs.map((tab) => ({
        ...tab,
        nodes: tab.nodes.map((node) =>
          node.kind === "pane" ? { ...node, sessionId: null } : node,
        ),
      })),
    ).toEqual(before);
    // The sidebar stays open until a command is selected; closing Search must not drop the command.
    await open();
    await dialog.getByRole("button", { name: "Commands", exact: true }).click();
    await expect(dialog.getByRole("option", { name: /New pane|Split|Focus pane/ })).toHaveCount(0);
    await input.fill("Shortcuts");
    await dialog.getByRole("option", { name: "Shortcuts", exact: true }).click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("combobox", { name: "Settings section" })).toHaveAttribute(
      "data-value",
      "shortcuts",
    );
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});
