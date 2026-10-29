import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { closeTab } from "./support/tabs.ts";

test("a closed chat is found by its pane name and reopens with its name, model and history", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-chat-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Resumable chats", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await composer.fill("remember the release checklist");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");

    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await pane.getByRole("textbox", { name: "Pane name", exact: true }).fill("Hello world");
    await page.keyboard.press("Enter");
    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await closeTab(page, 1).click();
    await expect(pane).toHaveCount(0);

    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Resume a chat…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resume a chat" });
    const option = dialog.getByRole("option");
    const search = dialog.getByRole("combobox", { name: "Search chats" });
    // The closed chat is newer than the CLIs' saved sessions listed with it, so it comes first.
    const chat = dialog.locator('[data-resume-row^="chat:"]');
    await expect(chat).toHaveCount(1);
    await expect(chat).toContainText("Hello world");
    await expect(option.first()).toHaveAttribute("data-resume-row", /^chat:/);
    // Found by what was said in it too, not only by its name.
    await search.fill("release checklist");
    await expect(option).toHaveCount(1);
    await search.fill("no such chat");
    await expect(option).toHaveCount(0);
    await search.fill("hello");
    await expect(option.first()).toHaveAttribute("aria-selected", "true");
    await expect(option.first()).toContainText("Hello world");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);

    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await expect(page.getByRole("log")).toContainText("remember the release checklist");
    await expect(page.getByRole("log")).toContainText("Hello from");
    await expect(page.getByLabel("Agent and model", { exact: true })).toHaveText("Fixture model");

    // Nothing is closed any more, and the shortcut opens the same list.
    await page.keyboard.press("Control+Shift+T");
    await page.keyboard.press("r");
    await expect(dialog).toBeVisible();
    await expect(chat).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a closed chat stays in the sidebar and in Search, and both reopen it", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-closed-chat-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closed chats", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await composer.fill("draft the launch notes");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    await closeTab(page, 1).click();
    await expect(pane).toHaveCount(0);

    // A closed chat stays under its workspace, muted.
    const closed = page
      .getByRole("list", { name: "Closed chats tabs", exact: true })
      .locator("button[data-agent-closed]");
    await expect(closed).toHaveCount(1);
    await expect(closed).toContainText("draft the launch notes");
    await closed.click();
    await expect(page.getByRole("log")).toContainText("draft the launch notes");
    await expect(closed).toHaveCount(0);

    await closeTab(page, 1).click();
    await expect(pane).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const search = page.getByRole("dialog", { name: "Search", exact: true });
    await search.getByRole("combobox").fill("launch notes codex");
    const result = search.locator('[data-search-result="closed-chat"]');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText("Closed chat");
    await search.getByRole("combobox").press("Enter");
    await expect(search).toHaveCount(0);
    await expect(page.getByRole("log")).toContainText("draft the launch notes");
    await expect(closed).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
