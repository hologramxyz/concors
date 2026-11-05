import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";
import { seedProject } from "./support/projects.ts";

/** Two workspaces on their own folders, and a chat with a reply in the second one seeded. */
async function setup(page: Page, from: string, to: string) {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "Destination", to);
  await seedProject(page, "Origin", from);
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
  await chooseProvider(page);
  const composer = page.getByRole("textbox", { name: "Message Codex" });
  await expect(composer).toBeEnabled();
  await composer.fill("first message");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("Hello from");
  return composer;
}
const rows = (page: Page, workspace: string) =>
  page.getByRole("list", { name: `${workspace} tabs`, exact: true });
const chatRow = (page: Page, workspace: string) =>
  rows(page, workspace)
    .locator("li[data-sidebar-row]")
    .filter({
      has: page.locator("[data-agent-id]"),
    });
const workspaceRow = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).locator("xpath=ancestor::li[1]");

test("dragging a chat onto another workspace moves it, and it keeps working in its own folder", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-to-"));
  // Only the folder the chat began in has this, so opening it proves where the chat still runs.
  await writeFile(join(from, "README.md"), "# Only in the origin folder");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const composer = await setup(page, from, to);
    const row = chatRow(page, "Origin");
    await expect(row).toHaveAttribute("draggable", "true");
    const destination = workspaceRow(page, "Destination");

    // The workspace it would land in says so; its own does not offer itself.
    await row.hover();
    await page.mouse.down();
    const box = await destination.boundingBox();
    if (!box) throw new Error("Workspace row missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    // A drop needs an "over" on where it lands, which a moving pointer alone does not produce.
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(destination).toHaveAttribute("data-drop-target", "true");
    await page.screenshot({ path: test.info().outputPath("chat-over-workspace.png") });
    await page.mouse.up();

    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    await expect(destination).not.toHaveAttribute("data-drop-target");
    // It was the chat in view, so the view went with it, with the conversation intact.
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("first message");

    await composer.fill("file-links");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("link", { name: "the README", exact: true }).click();
    await expect(page.getByText("Only in the origin folder")).toBeVisible();

    // The daemon's doing, not this window's: it is still there after a reload.
    await page.reload();
    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a closed chat moves from its menu, and opens in the workspace it moved to", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-closed-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-closed-to-"));
  try {
    await setup(page, from, to);
    const open = chatRow(page, "Origin");
    await open.hover();
    await page
      .getByRole("button", { name: /^Close .* tab$/ })
      .last()
      .click();
    const closed = rows(page, "Origin").locator('li[data-sidebar-row^="closed:"]');
    await expect(closed).toHaveCount(1);

    await closed.hover();
    await closed.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Move to workspace" }).click();
    await page.getByRole("menuitem", { name: "Destination", exact: true }).click();
    const moved = rows(page, "Destination").locator('li[data-sidebar-row^="closed:"]');
    await expect(moved).toHaveCount(1);
    await expect(closed).toHaveCount(0);

    await moved.locator("button[data-agent-id]").click();
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("first message");
    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(
      rows(page, "Destination")
        .locator('li[data-sidebar-row^="tab:"]')
        .filter({
          has: page.locator("[data-agent-id]"),
        }),
    ).toHaveCount(1);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a terminal's row stays put: it has no drag and no move in its menu", async ({ page }) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-terminal-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-terminal-to-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Destination", to);
    await seedProject(page, "Origin", from);
    const row = rows(page, "Origin").locator('li[data-sidebar-row^="tab:"]').first();
    await expect(row).toHaveAttribute("draggable", "false");
    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await expect(page.getByRole("menuitem", { name: "Rename tab" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Move to workspace" })).toHaveCount(0);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});
