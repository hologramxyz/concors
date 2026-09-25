import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("a closed chat is found by its pane name and reopens with its name, model and history", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-chat-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Resumable chats", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
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
    await page.getByRole("button", { name: "Close Tab 2 tab", exact: true }).click();
    await expect(pane).toHaveCount(0);

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Resume a chat…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resume a chat" });
    const option = dialog.getByRole("option");
    await expect(option).toHaveCount(1);
    await expect(option).toContainText("Hello world");
    await expect(option).toContainText("remember the release checklist");
    await dialog.getByRole("combobox", { name: "Search closed chats" }).fill("claude");
    await expect(option).toHaveCount(0);
    await dialog.getByRole("combobox", { name: "Search closed chats" }).fill("hello");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);

    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await expect(page.getByRole("log")).toContainText("remember the release checklist");
    await expect(page.getByRole("log")).toContainText("Hello from");
    await expect(page.getByLabel("Agent and model", { exact: true })).toHaveText("Fixture model");

    // Nothing is closed any more, and the shortcut opens the same list.
    await page.keyboard.press("Control+Shift+T");
    await page.keyboard.press("r");
    await expect(dialog).toContainText("No closed chats in this workspace yet.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
