import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { closeTab, tabs } from "./support/tabs.ts";

test("chats are pinned to the top of their workspace, and deleted after a confirmation", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pin-delete-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Pinned chats", directory);
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const rows = sidebar.getByRole("list", { name: "Pinned chats tabs" }).locator("> li");

    for (const message of ["hello there", "hello again"]) {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await chooseProvider(page);
      const composer = page.getByRole("textbox", { name: "Message Codex" });
      await expect(composer).toBeEnabled();
      await composer.fill(message);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log").filter({ visible: true })).toContainText("Hello from");
    }
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await pane.getByRole("textbox", { name: "Pane name", exact: true }).fill("Release notes");
    await page.keyboard.press("Enter");
    await closeTab(page, 2).click();
    const closed = rows.filter({ hasText: "Release notes" });
    await expect(closed.locator("button[data-agent-closed]")).toBeVisible();
    await expect(rows.first()).not.toContainText("Release notes");

    // Pinned, the closed chat leads its workspace with a pin; unpinned, it goes back. Rows keep
    // their places while the pointer is over the list, so it moves away to let them settle.
    const away = () => page.mouse.move(900, 500);
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    await expect(closed.getByRole("img", { name: "Pinned" })).toBeVisible();
    await away();
    await expect(rows.first()).toContainText("Release notes");
    await expect(rows.first().getByRole("img", { name: "Pinned" })).toBeVisible();
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
    await expect(closed.getByRole("img", { name: "Pinned" })).toHaveCount(0);
    await away();
    await expect(rows.first()).not.toContainText("Release notes");

    // Deleting asks first; cancelling keeps the chat.
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete “Release notes”?" });
    await expect(confirm).toContainText("This can’t be undone.");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(closed).toHaveCount(1);
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(closed).toHaveCount(0);

    // Deleting an open chat closes its tab too.
    await expect(tabs(page)).toHaveCount(2);
    const open = rows.filter({ has: page.locator("button[data-sidebar-tab-id]") }).last();
    await open.hover();
    await open.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog", { name: /^Delete “/ })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(sidebar.locator("button[data-agent-id]")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
